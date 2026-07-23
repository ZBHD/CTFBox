#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import copy
import threading
import types

from thirdparty.odict import OrderedDict
from thirdparty.six.moves import collections_abc as _collections

class AttribDict(dict):
    """
    This class defines the dictionary with added capability to access members as attributes

    >>> foo = AttribDict()
    >>> foo.bar = 1
    >>> foo.bar
    1
    """

    def __init__(self, indict=None, attribute=None, keycheck=True):
        if indict is None:
            indict = {}

        # 在初始化之前在此处设置任何属性
        # 这些仍然是正常属性
        self.attribute = attribute
        self.keycheck = keycheck
        dict.__init__(self, indict)
        self.__initialised = True

        # 初始化后，设置属性
        # 与设置项目相同

    def __getattr__(self, item):
        """
        Maps values to attributes
        Only called if there *is NOT* an attribute with this name
        """

        try:
            return self.__getitem__(item)
        except KeyError:
            if self.keycheck:
                raise AttributeError('无法访问项目“%s”' % item)
            else:
                return None

    def __delattr__(self, item):
        """
        Deletes attributes
        """

        try:
            return self.pop(item)
        except KeyError:
            if self.keycheck:
                raise AttributeError('无法访问项目“%s”' % item)
            else:
                return None

    def __setattr__(self, item, value):
        """
        Maps attributes to values
        Only if we are initialised
        """

        # 该测试允许在 __init__ 方法中设置属性
        if "_AttribDict__initialised" not in self.__dict__:
            return dict.__setattr__(self, item, value)

        # 任何普通属性都会正常处理
        elif item in self.__dict__:
            dict.__setattr__(self, item, value)

        else:
            self.__setitem__(item, value)

    def __getstate__(self):
        return self.__dict__

    def __setstate__(self, dict):
        self.__dict__ = dict

    def __deepcopy__(self, memo):
        retVal = self.__class__(keycheck=self.keycheck)
        memo[id(self)] = retVal

        for attr in dir(self):
            if not attr.startswith('_'):
                value = getattr(self, attr)
                if not isinstance(value, (types.BuiltinFunctionType, types.FunctionType, types.MethodType)):
                    setattr(retVal, attr, copy.deepcopy(value, memo))

        for key, value in self.items():
            retVal.__setitem__(key, copy.deepcopy(value, memo))

        return retVal

class InjectionDict(AttribDict):
    def __init__(self, **kwargs):
        AttribDict.__init__(self, **kwargs)

        self.place = None
        self.parameter = None
        self.ptype = None
        self.prefix = None
        self.suffix = None
        self.clause = None
        self.notes = []  # 注：https://github.com/sqlmapproject/sqlmap/issues/1888

        # data 是一个具有各种 stype 的字典，每个 stype 都是一个带有
        # 特定于该 stype 的所有信息
        self.data = AttribDict()

        # conf 是一个字典，存储重要的当前快照
        # 检测期间使用的选项
        self.conf = AttribDict()

        self.dbms = None
        self.dbms_version = None
        self.os = None

# 参考号：https://www.kunxi.org/2014/05/lru-cache-in-python
class LRUDict(object):
    """
    This class defines the LRU dictionary

    >>> foo = LRUDict(capacity=2)
    >>> foo["first"] = 1
    >>> foo["second"] = 2
    >>> foo["third"] = 3
    >>> "first" in foo
    False
    >>> "third" in foo
    True
    """

    def __init__(self, capacity):
        self.capacity = capacity
        self.cache = OrderedDict()
        self.__lock = threading.Lock()

    def __len__(self):
        return len(self.cache)

    def __contains__(self, key):
        return key in self.cache

    def __getitem__(self, key):
        with self.__lock:
            value = self.cache.pop(key)
            self.cache[key] = value
            return value

    def get(self, key, default=None):
        try:
            return self.__getitem__(key)
        except:
            return default

    def __setitem__(self, key, value):
        with self.__lock:
            try:
                self.cache.pop(key)
            except KeyError:
                if len(self.cache) >= self.capacity:
                    self.cache.popitem(last=False)
        self.cache[key] = value

    def set(self, key, value):
        self.__setitem__(key, value)

    def keys(self):
        return self.cache.keys()

# 参考号：https://code.activestate.com/recipes/576694/
class OrderedSet(_collections.MutableSet):
    """
    This class defines the set with ordered (as added) items

    >>> foo = OrderedSet()
    >>> foo.add(1)
    >>> foo.add(2)
    >>> foo.add(3)
    >>> foo.pop()
    3
    >>> foo.pop()
    2
    >>> foo.pop()
    1
    """

    def __init__(self, iterable=None):
        self.end = end = []
        end += [None, end, end]         # 双向链表的哨兵节点
        self.map = {}                   # 键 --> [键、上一个、下一个]
        if iterable is not None:
            self |= iterable

    def __len__(self):
        return len(self.map)

    def __contains__(self, key):
        return key in self.map

    def add(self, value):
        if value not in self.map:
            end = self.end
            curr = end[1]
            curr[2] = end[1] = self.map[value] = [value, curr, end]

    def discard(self, value):
        if value in self.map:
            value, prev, next = self.map.pop(value)
            prev[2] = next
            next[1] = prev

    def __iter__(self):
        end = self.end
        curr = end[2]
        while curr is not end:
            yield curr[0]
            curr = curr[2]

    def __reversed__(self):
        end = self.end
        curr = end[1]
        while curr is not end:
            yield curr[0]
            curr = curr[1]

    def pop(self, last=True):
        if not self:
            raise KeyError('设置为空')
        key = self.end[1][0] if last else self.end[2][0]
        self.discard(key)
        return key

    def __repr__(self):
        if not self:
            return '%s()' % (self.__class__.__name__,)
        return '%s(%r)' % (self.__class__.__name__, list(self))

    def __eq__(self, other):
        if isinstance(other, OrderedSet):
            return len(self) == len(other) and list(self) == list(other)
        return set(self) == set(other)
