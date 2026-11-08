#!/bin/bash
# 双击运行：把插件路径复制到剪贴板，并打开 Chrome 扩展页
DIR="$(cd "$(dirname "$0")" && pwd)"

printf '%s' "$DIR" | pbcopy

echo ""
echo "  =============================================="
echo "   看房距离助手 · 安装助手"
echo "  =============================================="
echo ""
echo "  插件路径（已复制到剪贴板）："
echo "  $DIR"
echo ""
echo "  接下来在 Chrome 里："
echo "   1. 打开右上角「开发者模式」开关"
echo "   2. 点左上角「加载已解压的扩展程序」"
echo "   3. 在弹出的窗口按 ⌘ + ⇧ + G，粘贴路径（⌘ + V）后回车"
echo "   4. 点「选择」"
echo ""
echo "  装好后打开 https://www.xiaohongshu.com/explore"
echo "  右下角会出现红色定位针按钮，先设置你的公司位置。"
echo ""

open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || open "chrome://extensions/" 2>/dev/null

read -n 1 -s -r -p "  按任意键关闭这个窗口…"
echo ""
