#!/usr/bin/env python3
import sys
if sys.version_info[:2] < (3, 6):
    print('[91m[!][0m SSTImap 是为 Python3.6 及更高版本创建的。 Python'+str(sys.version_info.major)+'.'+str(sys.version_info.minor)+' 不支持！')
    sys.exit()
if sys.version_info[:2] > (3, 14):
    print('[33m[!] [0m 此版本的 SSTImap 未使用 Python 进行测试'+str(sys.version_info.major)+'.'+str(sys.version_info.minor))
from utils import cliparser
from core import checks
from core.interactive import InteractiveShell
from utils.loggers import log
from utils.config import config_args, version
import traceback


def main():
    args = vars(cliparser.options)
    args = config_args(args)
    args['version'] = version
    from utils.loggers import formatter, no_colour
    formatter.colour = args.get("colour", True)
    if formatter.colour:
        print(cliparser.banner())
    else:
        print(no_colour(cliparser.banner()))
    from core.plugin import load_plugins, loaded_plugins
    load_plugins()
    from core.data_type import load_data_types, loaded_data_types_by_categories
    load_data_types()
    log.log(26, f"按类别加载的插件： {'; '.join([f'{x}: {len(loaded_plugins[x])}' for x in loaded_plugins])}")
    log.log(26, f"按类别加载的请求正文类型： {'; '.join([f'{x}: {len(loaded_data_types_by_categories[x])}' for x in loaded_data_types_by_categories])}")
    if not (args['url'] or args['interactive'] or args['load_urls'] or args['load_forms'] or args['module']):
        # 没有指定目标
        log.log(22, 'SSTImap 需要目标 URL (-u、--url)、URL/表单文件 (--load-urls / --load-forms) 或交互模式 (-i、--interactive)')
    elif args['module']:
        # 模块列表/帮助
        checks.module_info("" if args['module'] == 'list' else args['module'])
    elif args['interactive']:
        # 交互模式
        log.log(23, '以交互模式启动 SSTImap。输入“帮助”以查看详细信息。')
        InteractiveShell(args).cmdloop()
    else:
        # 预定模式
        checks.scan_website(args)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print()
        log.log(22, '正在退出')
    except Exception as e:
        log.critical(f'错误：{repr(e)}')
        log.debug(traceback.format_exc())
        raise e
