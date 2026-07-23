# 共享闭包
close_single_quotes = [("1'", "'1")]
close_double_quotes = [('1"', '"1')]
close_backticks = [('1`', '`1')]
close_single_double_quotes = close_single_quotes + close_double_quotes
integer = [('1', '1')]
float = [('1.0', '1.0')]
string = [('"1"', '"1"')]
close_dict = [('}', '{"1":'), (':1}', '{')]
close_function = [(')', '(')]
close_list = [(']', '[')]
empty = [('', '')]
close_triple_quotes = [('1"""', '"""1'), ("1'''", "'''1")]

# Python 三引号以及 if 和 for 循环终止。
if_loops = [(':', '')]
int_to_float = [('1.0', '1')]

# Javascript 需要这个来绕过分配
var = [('a', '')]

# Java 需要布尔值来绕过条件和可迭代对象
true_var = [('true', 'true')]
iterable_var = [('[1]', '')]
