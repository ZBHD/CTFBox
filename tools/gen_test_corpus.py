#!/usr/bin/env python
"""Generate real test challenges for all MISC modules."""
import base64, binascii, os, struct, math, hashlib, io, zipfile

os.makedirs("artifacts/test-corpus/cryptanalysis/classical", exist_ok=True)
os.makedirs("artifacts/test-corpus/cryptanalysis/rsa", exist_ok=True)
os.makedirs("artifacts/test-corpus/cryptanalysis/aes", exist_ok=True)
os.makedirs("artifacts/test-corpus/cryptanalysis/hash", exist_ok=True)
os.makedirs("artifacts/test-corpus/cryptanalysis/prng", exist_ok=True)
os.makedirs("artifacts/test-corpus/image-stego/jsteg", exist_ok=True)
os.makedirs("artifacts/test-corpus/image-stego/palette", exist_ok=True)
os.makedirs("artifacts/test-corpus/image-stego/combined", exist_ok=True)
os.makedirs("artifacts/test-corpus/audio-stego/dtmf", exist_ok=True)
os.makedirs("artifacts/test-corpus/audio-stego/echo", exist_ok=True)
os.makedirs("artifacts/test-corpus/audio-stego/lsb", exist_ok=True)
os.makedirs("artifacts/test-corpus/other-stego/text", exist_ok=True)
os.makedirs("artifacts/test-corpus/other-stego/qrcode", exist_ok=True)
os.makedirs("artifacts/test-corpus/other-stego/office", exist_ok=True)

# ===== MODULE 4: CRYPTANALYSIS =====
base = "artifacts/test-corpus/cryptanalysis"

# RSA 1: Common modulus
p, q = 61, 53
n = p * q
phi = (p - 1) * (q - 1)
e1, e2 = 17, 13
m = 42
c1 = pow(m, e1, n)
c2 = pow(m, e2, n)
with open(f"{base}/rsa/challenge-01-common-modulus.txt", "w") as f:
    f.write(f"n:{n}\ne1:{e1}\nc1:{c1}\ne2:{e2}\nc2:{c2}")
with open(f"{base}/rsa/README.txt", "w") as f:
    f.write(f"RSA 共模攻击: n=61*53, m=42 (flag{{42}})\nExpected: 恢复 m=42")

# RSA 2: Fermat factorization
p2, q2 = 1000000007, 1000000009
with open(f"{base}/rsa/challenge-02-fermat.txt", "w") as f:
    f.write(f"n:{p2 * q2}\ne:65537")
with open(f"{base}/rsa/README.txt", "w") as f:
    f.write(f"Fermat 分解: |p-q|=2, 极近素数\nExpected: Fermat 分解成功")

# RSA 3: Wiener attack (pre-computed)
sp, sq = 2003, 2011
sn = sp * sq
sphi = (sp - 1) * (sq - 1)
d_val = 179
e_val = pow(d_val, -1, sphi)  # Python 3.8+ modular inverse
with open(f"{base}/rsa/challenge-03-wiener.txt", "w") as f:
    f.write(f"n:{sn}\ne:{e_val}")
with open(f"{base}/rsa/README.txt", "w") as f:
    f.write(f"Wiener 攻击: n=2003*2011, d=179 (小私钥)\nExpected: Wiener 恢复 d=179")

# Hash 1: MD5("hello")
with open(f"{base}/hash/challenge-01-md5.txt", "w") as f:
    f.write("5d41402abc4b2a76b9719d911017c592")
with open(f"{base}/hash/challenge-02-sha256.txt", "w") as f:
    f.write("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
with open(f"{base}/hash/challenge-03-admin.txt", "w") as f:
    f.write(hashlib.md5(b"admin").hexdigest())
with open(f"{base}/hash/README.txt", "w") as f:
    f.write("Hash识别:\n1: MD5(hello)->彩虹hello\n2: SHA256(空)\n3: MD5(admin)->彩虹admin")

# Classical 1: Caesar ROT17
def caesar(text, shift):
    return "".join(chr((ord(c)-65+shift)%26+65) if c.isupper() else chr((ord(c)-97+shift)%26+97) if c.islower() else c for c in text)
with open(f"{base}/classical/challenge-01-caesar.txt", "w") as f:
    f.write(caesar("FLAG{CAESAR_ROT17}", 17))

# Classical 2: Atbash
def atbash(text):
    return "".join(chr(90-(ord(c)-65)) if c.isupper() else chr(122-(ord(c)-97)) if c.islower() else c for c in text)
with open(f"{base}/classical/challenge-02-atbash.txt", "w") as f:
    f.write(atbash("FLAG{ATBASH_CIPHER}"))

# Classical 3: Rail fence 3 rails
def rail_encrypt(text, rails):
    fence = [[] for _ in range(rails)]
    rail, direction = 0, 1
    for c in text:
        fence[rail].append(c)
        rail += direction
        if rail == rails - 1: direction = -1
        elif rail == 0: direction = 1
    return "".join("".join(row) for row in fence)
with open(f"{base}/classical/challenge-03-rail.txt", "w") as f:
    f.write(rail_encrypt("FLAG{RAILFENCE}!", 3))

# AES: ECB detection
block = b"flag{ecb_detect}!"  # 16 bytes
ecb_data = block * 8
with open(f"{base}/aes/challenge-01-ecb.bin", "wb") as f:
    f.write(ecb_data)
with open(f"{base}/aes/README.txt", "w") as f:
    f.write("AES ECB检测: 8个相同16字节块\nExpected: ECB detected")

# PRNG: LCG sequence
a_lcg, c_lcg, mod_lcg = 1103515245, 12345, 1 << 31
x = 42
vals = []
for _ in range(5):
    x = (a_lcg * x + c_lcg) % mod_lcg
    vals.append(str(x))
with open(f"{base}/prng/challenge-01-lcg.txt", "w") as f:
    f.write(" ".join(vals[:5]))

# PRNG: MT19937 outputs
class MT:
    def __init__(self, seed):
        self.mt = [0] * 624
        self.mt[0] = seed
        for i in range(1, 624):
            self.mt[i] = (1812433253 * (self.mt[i-1] ^ (self.mt[i-1] >> 30)) + i) & 0xFFFFFFFF
        self.i = 624
    def next(self):
        if self.i >= 624:
            for i in range(624):
                y = (self.mt[i] & 0x80000000) + (self.mt[(i+1)%624] & 0x7FFFFFFF)
                self.mt[i] = self.mt[(i+397)%624] ^ (y >> 1)
                if y & 1: self.mt[i] ^= 0x9908B0DF
            self.i = 0
        y = self.mt[self.i]; self.i += 1
        y ^= y >> 11; y ^= (y << 7) & 0x9D2C5680
        y ^= (y << 15) & 0xEFC60000; y ^= y >> 18
        return y & 0xFFFFFFFF
mt = MT(12345)
mt_vals = [str(mt.next()) for _ in range(10)]
with open(f"{base}/prng/challenge-02-mt19937.txt", "w") as f:
    f.write(" ".join(mt_vals[:10]))
with open(f"{base}/prng/README.txt", "w") as f:
    f.write("PRNG恢复:\n1: LCG序列 (a=1103515245,c=12345,m=2^31)\n2: MT19937 10输出 (seed=12345)")

print("Module 4: cryptanalysis challenges done")

# ===== MODULE 1: IMAGE STEGO =====
base_i = "artifacts/test-corpus/image-stego"

# Palette: 8-color luminance-sorted with LSB payload in Red channel
palette_rgb = bytearray(24)
for i in range(8):
    palette_rgb[i*3] = (i*32) | ((i//2) & 1)
    palette_rgb[i*3+1] = i * 25
    palette_rgb[i*3+2] = i * 20
with open(f"{base_i}/palette/challenge-01-luminance.bin", "wb") as f:
    f.write(palette_rgb)
with open(f"{base_i}/palette/README.txt", "w") as f:
    f.write("8色调色板, 亮度排序(暗→亮), R通道LSB携带数据\nExpected: 检测到亮度排序")

# JPEG with trailing data
class JpegBuilder:
    @staticmethod
    def build(trailer_data: bytes) -> bytes:
        buf = bytearray()
        # SOI
        buf += bytes([0xFF, 0xD8])
        # APP0 (JFIF)
        app0 = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        buf += bytes([0xFF, 0xE0, 0, len(app0)+2])
        buf += app0
        # SOF0 (baseline, 1x1 grayscale)
        buf += bytes([0xFF, 0xC0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0, 0x11, 0, 0x11, 1])
        # DQT
        buf += bytes([0xFF, 0xDB, 0, 67, 0])
        buf += bytes([16]*64)
        # DHT
        buf += bytes([0xFF, 0xC4, 0, 31, 0, 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15])
        buf += bytes([0]*16)
        # SOS + minimal scan
        buf += bytes([0xFF, 0xDA, 0, 8, 1, 0, 0, 0x3F, 0, 0, 0, 0])
        # Trailing data
        buf += trailer_data
        # EOI
        buf += bytes([0xFF, 0xD9])
        return bytes(buf)

trailer = b"flag{jpeg_trailing_data}"
with open(f"{base_i}/combined/challenge-01-jpeg-trailing.jpg", "wb") as f:
    f.write(JpegBuilder.build(trailer))
with open(f"{base_i}/combined/README.txt", "w") as f:
    f.write("JPEG文件尾附加数据: flag{{jpeg_trailing_data}}\nExpected: 结构分析发现EOI后数据")

print("Module 1: image stego challenges done")

# ===== MODULE 2: AUDIO STEGO =====
base_a = "artifacts/test-corpus/audio-stego"

def write_wav(filename, samples, sample_rate, channels=1):
    """Write a valid WAV file. fmt chunk starts at offset 12 (after RIFF+size+WAVE)."""
    ns = len(samples)
    data_size = ns * 2  # 16-bit
    fmt_offset = 12
    fmt_size = 16
    data_offset = fmt_offset + 8 + fmt_size  # 12 + 4("fmt ") + 4(size) + 16 = 36
    file_size = data_offset + 8 + data_size - 8  # RIFF size = total - 8
    wav = bytearray(data_offset + 8 + data_size)
    # RIFF header: offset 0, 12 bytes
    struct.pack_into("<4sI4s", wav, 0, b"RIFF", file_size, b"WAVE")
    # fmt chunk: offset 12 (NOT 8!)
    struct.pack_into("<4sIHHIIHH", wav, fmt_offset, b"fmt ", fmt_size, 1, channels, sample_rate, sample_rate * channels * 2, channels * 2, 16)
    # data chunk: offset 36
    struct.pack_into("<4sI", wav, data_offset, b"data", data_size)
    for i, s in enumerate(samples):
        struct.pack_into("<h", wav, data_offset + 8 + i * 2, max(-32768, min(32767, int(s))))
    with open(filename, "wb") as f:
        f.write(wav)

# DTMF tones in WAV: 1-2-3-4
sample_rate = 8000
tone_dur = 0.1
def gen_dtmf_samples(freq1, freq2, dur, sr):
    ns = int(dur * sr)
    return [16000 * (math.sin(2*math.pi*freq1*t/sr) + math.sin(2*math.pi*freq2*t/sr)) / 2 for t in range(ns)]

dtmf_pairs = [(697,1209), (697,1336), (697,1477), (770,1209)]  # 1,2,3,4
gap_samples = int(0.02 * sample_rate)  # 20ms silence gap between tones
all_samples = []
for f1, f2 in dtmf_pairs:
    all_samples.extend(gen_dtmf_samples(f1, f2, tone_dur, sample_rate))
    all_samples.extend([0] * gap_samples)

write_wav(f"{base_a}/dtmf/challenge-01-dtmf.wav", all_samples, sample_rate)
with open(f"{base_a}/dtmf/README.txt", "w") as f:
    f.write("DTMF拨号音: 1-2-3-4 (697/1209,697/1336,697/1477,770/1209)\nExpected: DTMF序列 '1234'")

# Simple WAV with LSB payload
pcm_samples = [0.0] * 1000
flag_bits = "".join(format(ord(c), "08b") for c in "flag{audio_lsb}")
for i, bit in enumerate(flag_bits[:len(pcm_samples)]):
    pcm_samples[i] = (int(pcm_samples[i]) & 0xFFFE) | int(bit)

write_wav(f"{base_a}/lsb/challenge-01-lsb.wav", pcm_samples, 44100)
with open(f"{base_a}/lsb/README.txt", "w") as f:
    f.write("WAV LSB隐写: LSB编码 flag{{audio_lsb}}\nExpected: LSB提取命中flag")

print("Module 2: audio stego challenges done")

# ===== MODULE 5: OTHER STEGO =====
base_o = "artifacts/test-corpus/other-stego"

# Zero-width: ZWSP=0, ZWNJ=1 encoding 'flag'
zwsp = "​"; zwnj = "‌"
def to_zw(text):
    bits = "".join(format(ord(c), "08b") for c in text)
    return "".join(zwnj if b == "1" else zwsp for b in bits)

with open(f"{base_o}/text/challenge-01-zerowidth.txt", "w", encoding="utf-8") as f:
    f.write(f"Normal visible text.{to_zw('flag')}More visible text.")
with open(f"{base_o}/text/README.txt", "w") as f:
    f.write("零宽字符隐写: ZWSP=0, ZWNJ=1, 编码 'flag'\nExpected: 检测到零宽字符 + 提取payload")

# Case encoding
case_bits = "".join(format(ord(c), "08b") for c in "hi")
case_text = "".join(c.upper() if b == "1" else c.lower() for c, b in zip("abcdefghijklmnop", case_bits))
with open(f"{base_o}/text/challenge-02-case.txt", "w") as f:
    f.write(case_text)
with open(f"{base_o}/text/README.txt", "w") as f:
    f.write("大小写编码: UPPER=1, lower=0, 编码 'hi' (16字母=16bits)\nExpected: 大小写检测+提取")

# Trailing whitespace (write binary to avoid Windows \r\n translation)
lines = ["Line 1    ", "Line 2  ", "Line 3     ", "Line 4       ", "Line 5   "]
with open(f"{base_o}/text/challenge-03-trailing.txt", "wb") as f:
    f.write("\n".join(lines).encode("utf-8"))
with open(f"{base_o}/text/README.txt", "w") as f:
    f.write("行尾空白: 5行各有2-7个尾部空格\nExpected: 检测到行尾空白字符")

# Barcode (pure data, no prefix text)
with open(f"{base_o}/qrcode/challenge-01-ean13.txt", "w") as f:
    f.write("5901234123457")
with open(f"{base_o}/qrcode/challenge-02-code39.txt", "w") as f:
    f.write("*CODE39-TEST*")

# Office: minimal DOCX with hidden text
zip_buf = io.BytesIO()
with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
    ct = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
    zf.writestr("[Content_Types].xml", ct)
    doc = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:vanish/><w:t>flag{ooxml_hidden_text}</w:t></w:r></w:p></w:body></w:document>'
    zf.writestr("word/document.xml", doc)
with open(f"{base_o}/office/challenge-01-hidden.docx", "wb") as f:
    f.write(zip_buf.getvalue())
with open(f"{base_o}/office/README.txt", "w") as f:
    f.write("OOXML DOCX with vanish hidden text\nExpected: 检测到隐藏文字+提取flag{{ooxml_hidden_text}}")

print("Module 5: other stego challenges done")
print("\nAll test challenges generated!")
print(f"artifacts/test-corpus/cryptanalysis/ : {sum(1 for _ in os.walk(base))} dirs")
print(f"artifacts/test-corpus/image-stego/   : {sum(1 for _ in os.walk('artifacts/test-corpus/image-stego'))} dirs")
print(f"artifacts/test-corpus/audio-stego/   : {sum(1 for _ in os.walk('artifacts/test-corpus/audio-stego'))} dirs")
print(f"artifacts/test-corpus/other-stego/   : {sum(1 for _ in os.walk('artifacts/test-corpus/other-stego'))} dirs")
