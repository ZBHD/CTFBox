"""纯 Python AES 实现（ECB / CBC，PKCS7 填充）。

仅为 webshell 引擎的冰蝎协议对接提供 AES-128；不追求性能，只求正确与零依赖。
算法遵循 FIPS-197。正确性在测试中与 pycryptodome 对拍。
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# S-box 与逆 S-box（FIPS-197 标准常量表）
# ---------------------------------------------------------------------------

# fmt: off
SBOX = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]
# fmt: on

INV_SBOX = [0] * 256
for _i, _v in enumerate(SBOX):
    INV_SBOX[_v] = _i
RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36]


def _xtime(a: int) -> int:
    return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else (a << 1) & 0xFF


def _mul(a: int, b: int) -> int:
    """GF(2^8) 乘法。"""
    result = 0
    for _ in range(8):
        if b & 1:
            result ^= a
        a = _xtime(a)
        b >>= 1
    return result & 0xFF


class AES:
    """AES 分组密码（当前用到 128 位密钥，实现对 128/192/256 通用）。"""

    def __init__(self, key: bytes) -> None:
        if len(key) not in (16, 24, 32):
            raise ValueError("AES 密钥长度必须为 16/24/32 字节")
        self.rounds = {16: 10, 24: 12, 32: 14}[len(key)]
        self._round_keys = self._expand_key(key)

    # -- 密钥扩展 --------------------------------------------------------
    def _expand_key(self, key: bytes) -> list[list[int]]:
        key_columns = [list(key[i : i + 4]) for i in range(0, len(key), 4)]
        nk = len(key_columns)
        total = 4 * (self.rounds + 1)
        i = nk
        while i < total:
            temp = list(key_columns[i - 1])
            if i % nk == 0:
                temp = temp[1:] + temp[:1]  # RotWord
                temp = [SBOX[b] for b in temp]  # SubWord
                temp[0] ^= RCON[i // nk - 1]
            elif nk > 6 and i % nk == 4:
                temp = [SBOX[b] for b in temp]
            key_columns.append([key_columns[i - nk][j] ^ temp[j] for j in range(4)])
            i += 1
        return key_columns

    def _round_key(self, rnd: int) -> list[list[int]]:
        return self._round_keys[rnd * 4 : rnd * 4 + 4]

    # -- 状态变换 --------------------------------------------------------
    @staticmethod
    def _add_round_key(state: list[list[int]], rk: list[list[int]]) -> None:
        for c in range(4):
            for r in range(4):
                state[r][c] ^= rk[c][r]

    @staticmethod
    def _sub_bytes(state: list[list[int]], box: list[int]) -> None:
        for r in range(4):
            for c in range(4):
                state[r][c] = box[state[r][c]]

    @staticmethod
    def _shift_rows(state: list[list[int]], inverse: bool = False) -> None:
        for r in range(1, 4):
            shift = -r if inverse else r
            state[r] = state[r][shift:] + state[r][:shift]

    @staticmethod
    def _mix_columns(state: list[list[int]], inverse: bool = False) -> None:
        coeffs = (0x0E, 0x0B, 0x0D, 0x09) if inverse else (0x02, 0x03, 0x01, 0x01)
        for c in range(4):
            col = [state[r][c] for r in range(4)]
            for r in range(4):
                state[r][c] = (
                    _mul(col[0], coeffs[(0 - r) % 4])
                    ^ _mul(col[1], coeffs[(1 - r) % 4])
                    ^ _mul(col[2], coeffs[(2 - r) % 4])
                    ^ _mul(col[3], coeffs[(3 - r) % 4])
                )

    # -- 分组加解密 ------------------------------------------------------
    def encrypt_block(self, block: bytes) -> bytes:
        state = [[block[r + 4 * c] for c in range(4)] for r in range(4)]
        self._add_round_key(state, self._round_key(0))
        for rnd in range(1, self.rounds):
            self._sub_bytes(state, SBOX)
            self._shift_rows(state)
            self._mix_columns(state)
            self._add_round_key(state, self._round_key(rnd))
        self._sub_bytes(state, SBOX)
        self._shift_rows(state)
        self._add_round_key(state, self._round_key(self.rounds))
        return bytes(state[r][c] for c in range(4) for r in range(4))

    def decrypt_block(self, block: bytes) -> bytes:
        state = [[block[r + 4 * c] for c in range(4)] for r in range(4)]
        self._add_round_key(state, self._round_key(self.rounds))
        for rnd in range(self.rounds - 1, 0, -1):
            self._shift_rows(state, inverse=True)
            self._sub_bytes(state, INV_SBOX)
            self._add_round_key(state, self._round_key(rnd))
            self._mix_columns(state, inverse=True)
        self._shift_rows(state, inverse=True)
        self._sub_bytes(state, INV_SBOX)
        self._add_round_key(state, self._round_key(0))
        return bytes(state[r][c] for c in range(4) for r in range(4))


# ---------------------------------------------------------------------------
# PKCS7 与模式封装
# ---------------------------------------------------------------------------

def pkcs7_pad(data: bytes, block: int = 16) -> bytes:
    pad = block - (len(data) % block)
    return data + bytes([pad]) * pad


def pkcs7_unpad(data: bytes, block: int = 16) -> bytes:
    if not data or len(data) % block != 0:
        raise ValueError("密文长度非法")
    pad = data[-1]
    if pad < 1 or pad > block or data[-pad:] != bytes([pad]) * pad:
        raise ValueError("PKCS7 填充非法")
    return data[:-pad]


def aes_ecb_encrypt(key: bytes, plaintext: bytes) -> bytes:
    cipher = AES(key)
    padded = pkcs7_pad(plaintext)
    return b"".join(cipher.encrypt_block(padded[i : i + 16]) for i in range(0, len(padded), 16))


def aes_ecb_decrypt(key: bytes, ciphertext: bytes) -> bytes:
    cipher = AES(key)
    if len(ciphertext) % 16 != 0:
        raise ValueError("ECB 密文长度必须为 16 的倍数")
    plain = b"".join(cipher.decrypt_block(ciphertext[i : i + 16]) for i in range(0, len(ciphertext), 16))
    return pkcs7_unpad(plain)


def aes_cbc_encrypt(key: bytes, iv: bytes, plaintext: bytes) -> bytes:
    cipher = AES(key)
    padded = pkcs7_pad(plaintext)
    out = bytearray()
    prev = iv
    for i in range(0, len(padded), 16):
        block = bytes(a ^ b for a, b in zip(padded[i : i + 16], prev))
        prev = cipher.encrypt_block(block)
        out += prev
    return bytes(out)


def aes_cbc_decrypt(key: bytes, iv: bytes, ciphertext: bytes) -> bytes:
    cipher = AES(key)
    if len(ciphertext) % 16 != 0:
        raise ValueError("CBC 密文长度必须为 16 的倍数")
    out = bytearray()
    prev = iv
    for i in range(0, len(ciphertext), 16):
        block = ciphertext[i : i + 16]
        decrypted = cipher.decrypt_block(block)
        out += bytes(a ^ b for a, b in zip(decrypted, prev))
        prev = block
    return pkcs7_unpad(bytes(out))
