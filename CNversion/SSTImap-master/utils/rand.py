import random
import string


def randint_n(n, m=9):
    # m - 最大第一位数字
    # 如果长度为1，则从2开始，以避免
    # 评估时的重复次数，例如1*8=8
    # 造成误报
    if n == 1:
        range_start = 2
    else:
        range_start = 10**(n-1)
    range_end = (m+1)*(10**(n-1))-1
    return random.randint(range_start, range_end)


letters = string.ascii_letters
digits = string.digits


def randstr_n(n, chars=letters + digits):
    return ''.join(random.choice(chars) for _ in range(n))


# 生成静态随机整数
# 帮助填充动作['render']
randints = [randint_n(2) for _ in range(3)]

# 生成静态随机整数
# 帮助填充动作['render']
randstrings = [randstr_n(2) for _ in range(3)]
