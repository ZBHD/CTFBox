"""自带 AES 原语的正确性测试：FIPS-197 向量 + 与 pycryptodome 交叉验证。"""

from __future__ import annotations

import os

import pytest

from crypto import aes_cbc_decrypt, aes_cbc_encrypt, aes_ecb_decrypt, aes_ecb_encrypt
from crypto.aes import AES


def test_fips197_single_block():
    # FIPS-197 附录 B 示例
    key = bytes.fromhex("2b7e151628aed2a6abf7158809cf4f3c")
    plaintext = bytes.fromhex("3243f6a8885a308d313198a2e0370734")
    expected = bytes.fromhex("3925841d02dc09fbdc118597196a0b32")
    assert AES(key).encrypt_block(plaintext) == expected
    assert AES(key).decrypt_block(expected) == plaintext


def test_fips197_appendix_c():
    # FIPS-197 附录 C.1（AES-128）
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    plaintext = bytes.fromhex("00112233445566778899aabbccddeeff")
    expected = bytes.fromhex("69c4e0d86a7b0430d8cdb78070b4c55a")
    assert AES(key).encrypt_block(plaintext) == expected


def test_ecb_roundtrip_padding():
    key = b"e45e329feb5d925b"
    for length in (0, 1, 15, 16, 17, 100):
        data = os.urandom(length)
        cipher = aes_ecb_encrypt(key, data)
        assert len(cipher) % 16 == 0
        assert aes_ecb_decrypt(key, cipher) == data


def test_cbc_roundtrip():
    key = os.urandom(16)
    iv = os.urandom(16)
    data = os.urandom(64) + b"tail"
    cipher = aes_cbc_encrypt(key, iv, data)
    assert aes_cbc_decrypt(key, iv, cipher) == data


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("Crypto") is None,
    reason="pycryptodome 未安装",
)
def test_cross_check_pycryptodome():
    from Crypto.Cipher import AES as RefAES
    from Crypto.Util.Padding import pad

    key = b"e45e329feb5d925b"
    data = b"behinder-cross-check-payload-123"
    ref = RefAES.new(key, RefAES.MODE_ECB).encrypt(pad(data, 16))
    assert aes_ecb_encrypt(key, data) == ref
