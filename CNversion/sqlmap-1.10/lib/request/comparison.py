#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from __future__ import division

import re

from lib.core.common import extractRegexResult
from lib.core.common import getFilteredPageContent
from lib.core.common import listToStrValue
from lib.core.common import removeDynamicContent
from lib.core.common import getLastRequestHTTPError
from lib.core.common import wasLastResponseDBMSError
from lib.core.common import wasLastResponseHTTPError
from lib.core.convert import getBytes
from lib.core.data import conf
from lib.core.data import kb
from lib.core.data import logger
from lib.core.exception import SqlmapNoneDataException
from lib.core.settings import DEFAULT_PAGE_ENCODING
from lib.core.settings import DIFF_TOLERANCE
from lib.core.settings import HTML_TITLE_REGEX
from lib.core.settings import LOWER_RATIO_BOUND
from lib.core.settings import MAX_DIFFLIB_SEQUENCE_LENGTH
from lib.core.settings import MAX_RATIO
from lib.core.settings import MIN_RATIO
from lib.core.settings import REFLECTED_VALUE_MARKER
from lib.core.settings import UPPER_RATIO_BOUND
from lib.core.settings import URI_HTTP_HEADER
from lib.core.threads import getCurrentThreadData
from thirdparty import six

def comparison(page, headers, code=None, getRatioValue=False, pageLength=None):
    if not isinstance(page, (six.text_type, six.binary_type, type(None))):
        logger.critical('得到类型为%s的页面；重复（页）[:200]=%s' % (type(page), repr(page)[:200]))

        try:
            page = b"".join(page)
        except:
            page = six.text_type(page)

    _ = _adjust(_comparison(page, headers, code, getRatioValue, pageLength), getRatioValue)
    return _

def _adjust(condition, getRatioValue):
    if not any((conf.string, conf.notString, conf.regexp, conf.code)):
        # 原始页面比较方案中使用负逻辑方法，因为什么与原始页面“不同”
        # PAYLOAD.WHERE.NEGATIVE 响应被视为 True；在基于开关的方法中，负逻辑不是
        # 应用时，用户认为 True 的内容是比较机制返回的内容
        # itself
        retVal = not condition if kb.negativeLogic and condition is not None and not getRatioValue else condition
    else:
        retVal = condition if not getRatioValue else (MAX_RATIO if condition else MIN_RATIO)

    return retVal

def _comparison(page, headers, code, getRatioValue, pageLength):
    threadData = getCurrentThreadData()

    if kb.testMode:
        threadData.lastComparisonHeaders = listToStrValue(_ for _ in headers.headers if not _.startswith("%s:" % URI_HTTP_HEADER)) if headers else ""
        threadData.lastComparisonPage = page
        threadData.lastComparisonCode = code

    if page is None and pageLength is None:
        return None

    if any((conf.string, conf.notString, conf.regexp)):
        rawResponse = "%s%s" % (listToStrValue(_ for _ in headers.headers if not _.startswith("%s:" % URI_HTTP_HEADER)) if headers else "", page)

        # 当查询为 True 时在页面中匹配的字符串
        if conf.string:
            return conf.string in rawResponse

        # 当查询为 False 时在页面中匹配的字符串
        if conf.notString:
            if conf.notString in rawResponse:
                return False
            else:
                if kb.errorIsNone and (wasLastResponseDBMSError() or wasLastResponseHTTPError()):
                    return None
                else:
                    return True

        # 当查询为 True 和/或有效时，在页面中匹配的正则表达式
        if conf.regexp:
            return re.search(conf.regexp, rawResponse, re.I | re.M) is not None

    # 查询有效时匹配的 HTTP 代码
    if conf.code:
        return conf.code == code

    seqMatcher = threadData.seqMatcher
    seqMatcher.set_seq1(kb.pageTemplate)

    if page:
        # 如果出现 DBMS 错误页面，则返回 None
        if kb.errorIsNone and (wasLastResponseDBMSError() or wasLastResponseHTTPError()) and not kb.negativeLogic:
            if not (wasLastResponseHTTPError() and getLastRequestHTTPError() in (conf.ignoreCode or [])):
                return None

        # 比较之前要排除的动态内容行
        if not kb.nullConnection:
            page = removeDynamicContent(page)
            if threadData.lastPageTemplate != kb.pageTemplate:
                threadData.lastPageTemplateCleaned = removeDynamicContent(kb.pageTemplate)
                threadData.lastPageTemplate = kb.pageTemplate

            seqMatcher.set_seq1(threadData.lastPageTemplateCleaned)

        if not pageLength:
            pageLength = len(page)

    if kb.nullConnection and pageLength:
        if not seqMatcher.a:
            errMsg = '检索原始页面内容时出现问题 '
            errMsg += '这会阻止 sqlmap 继续。请重新运行， '
            errMsg += '如果问题仍然存在，请关闭所有优化开关'
            raise SqlmapNoneDataException(errMsg)

        ratio = 1. * pageLength / len(seqMatcher.a)

        if ratio > 1.:
            ratio = 1. / ratio
    else:
        # 防止“Unicode 相等比较未能将两个参数转换为 Unicode”
        # （例如，如果一页是 PDF，另一页是 HTML）
        if isinstance(seqMatcher.a, six.binary_type) and isinstance(page, six.text_type):
            page = getBytes(page, kb.pageEncoding or DEFAULT_PAGE_ENCODING, "ignore")
        elif isinstance(seqMatcher.a, six.text_type) and isinstance(page, six.binary_type):
            seqMatcher.set_seq1(getBytes(seqMatcher.a, kb.pageEncoding or DEFAULT_PAGE_ENCODING, "ignore"))

        if any(_ is None for _ in (page, seqMatcher.a)):
            return None
        elif seqMatcher.a and page and seqMatcher.a == page:
            ratio = 1.
        elif kb.skipSeqMatcher or seqMatcher.a and page and any(len(_) > MAX_DIFFLIB_SEQUENCE_LENGTH for _ in (seqMatcher.a, page)):
            if not page or not seqMatcher.a:
                return float(seqMatcher.a == page)
            else:
                ratio = 1. * len(seqMatcher.a) / len(page)
                if ratio > 1:
                    ratio = 1. / ratio
        else:
            seq1, seq2 = None, None

            if conf.titles:
                seq1 = extractRegexResult(HTML_TITLE_REGEX, seqMatcher.a)
                seq2 = extractRegexResult(HTML_TITLE_REGEX, page)
            else:
                seq1 = getFilteredPageContent(seqMatcher.a, True) if conf.textOnly else seqMatcher.a
                seq2 = getFilteredPageContent(page, True) if conf.textOnly else page

            if seq1 is None or seq2 is None:
                return None

            if isinstance(seq1, six.binary_type):
                seq1 = seq1.replace(REFLECTED_VALUE_MARKER.encode(), b"")
            elif isinstance(seq1, six.text_type):
                seq1 = seq1.replace(REFLECTED_VALUE_MARKER, "")

            if isinstance(seq2, six.binary_type):
                seq2 = seq2.replace(REFLECTED_VALUE_MARKER.encode(), b"")
            elif isinstance(seq2, six.text_type):
                seq2 = seq2.replace(REFLECTED_VALUE_MARKER, "")

            if kb.heavilyDynamic:
                seq1 = seq1.split("\n" if isinstance(seq1, six.text_type) else b"\n")
                seq2 = seq2.split("\n" if isinstance(seq2, six.text_type) else b"\n")

                key = None
            else:
                key = (hash(seq1), hash(seq2))

            seqMatcher.set_seq1(seq1)
            seqMatcher.set_seq2(seq2)

            if key in kb.cache.comparison:
                ratio = kb.cache.comparison[key]
            else:
                try:
                    ratio = seqMatcher.quick_ratio() if not kb.heavilyDynamic else seqMatcher.ratio()
                except (TypeError, MemoryError):
                    ratio = seqMatcher.ratio()

                ratio = round(ratio, 3)

            if key:
                kb.cache.comparison[key] = ratio

    # 如果url稳定并且我们还没有设置匹配率和
    # 当前注入的值改变了url页面内容
    if kb.matchRatio is None:
        if ratio >= LOWER_RATIO_BOUND and ratio <= UPPER_RATIO_BOUND:
            kb.matchRatio = ratio
            logger.debug('设置当前参数与%.3f的匹配率' % kb.matchRatio)

    if kb.testMode:
        threadData.lastComparisonRatio = ratio

    # 如果要求返回比率而不是比较
    # response
    if getRatioValue:
        return ratio

    elif ratio > UPPER_RATIO_BOUND:
        return True

    elif ratio < LOWER_RATIO_BOUND:
        return False

    elif kb.matchRatio is None:
        return None

    else:
        return (ratio - kb.matchRatio) > DIFF_TOLERANCE
