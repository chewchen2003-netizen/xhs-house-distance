#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包给朋友用的分发版：

  dist/看房距离助手-vX.Y.Z/
    ├── 安装教程.html          # 双击打开，图文步骤（图片内嵌，单文件）
    ├── 一键安装.command       # macOS：开扩展页 + 复制路径
    ├── 一键安装.bat           # Windows：同上
    ├── extension/             # Chrome 扩展本体
    └── 手机版.html            # 手机单文件网页

用法：python3 tools/build-dist.py
"""
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

EXT_FILES = ["manifest.json", "background.js", "README.md"]
EXT_DIRS = ["lib", "content", "popup", "icons"]

SHOTS = [
    ("docs/preview-feed.png", "刷信息流时，标题下面直接多一行距离"),
    ("docs/preview-detail.png", "点进笔记，笔记里提到的小区自动列成清单"),
    ("docs/preview-panel.png", "点开任意一条，看地铁 / 打车 / 最近地铁站"),
    ("docs/preview-favs.png", "收藏夹：按通勤远近排好，可以复制清单发人"),
]


def embed(path, width=1000, quality=74):
    """把截图压成 JPEG 并内联成 data URI，保证教程是单文件。"""
    try:
        from PIL import Image
    except ImportError:
        sys.exit("需要 Pillow：pip3 install pillow")
    abs_path = os.path.join(ROOT, path)
    img = Image.open(abs_path).convert("RGB")
    if img.width > width:
        h = round(img.height * width / img.width)
        img = img.resize((width, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return "data:image/jpeg;base64," + b64


TUTORIAL = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>看房距离助手 · 安装教程</title>
<style>
  :root {{ --red:#ff2442; --ink:#1f1f1f; --muted:#999; --line:#eee; }}
  * {{ box-sizing:border-box; }}
  body {{
    margin:0; padding:0 0 60px; background:#f7f7f8; color:var(--ink);
    font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  }}
  .wrap {{ max-width:760px; margin:0 auto; padding:0 18px; }}
  header {{
    background:linear-gradient(160deg,#fff2f4,#fff 60%); padding:44px 0 30px;
    border-bottom:1px solid var(--line); margin-bottom:26px;
  }}
  .badge {{
    display:inline-flex; align-items:center; gap:8px; background:var(--red); color:#fff;
    padding:4px 12px; border-radius:999px; font-size:13px; font-weight:600;
  }}
  h1 {{ font-size:30px; margin:16px 0 6px; letter-spacing:-.5px; }}
  .sub {{ color:#666; font-size:15px; margin:0; }}
  h2 {{ font-size:20px; margin:38px 0 12px; }}
  h2 .n {{
    display:inline-flex; align-items:center; justify-content:center;
    width:26px; height:26px; border-radius:8px; background:var(--red); color:#fff;
    font-size:14px; margin-right:10px; vertical-align:2px;
  }}
  .card {{ background:#fff; border-radius:16px; padding:22px 24px; box-shadow:0 1px 3px rgba(0,0,0,.05); margin:14px 0; }}
  ol {{ padding-left:22px; margin:10px 0; }}
  ol li {{ margin:9px 0; }}
  code, .path {{
    background:#f2f3f5; border-radius:6px; padding:2px 7px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13.5px;
  }}
  .path {{ display:inline-block; word-break:break-all; }}
  kbd {{
    background:#fff; border:1px solid #ddd; border-bottom-width:2px; border-radius:6px;
    padding:1px 6px; font-family:inherit; font-size:13px;
  }}
  .shot {{ margin:18px 0; }}
  .shot img {{ width:100%; border-radius:12px; display:block; box-shadow:0 2px 10px rgba(0,0,0,.08); }}
  .shot figcaption {{ color:var(--muted); font-size:13px; text-align:center; margin-top:8px; }}
  .tip {{
    background:#fff8e6; border-left:4px solid #ffc53d; border-radius:0 10px 10px 0;
    padding:12px 16px; font-size:14.5px; margin:14px 0;
  }}
  .ok {{ background:#f0fff4; border-left-color:#52c41a; }}
  table {{ width:100%; border-collapse:collapse; margin:12px 0; font-size:14.5px; }}
  th, td {{ text-align:left; padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }}
  th {{ color:#666; font-weight:600; width:34%; }}
  footer {{ text-align:center; color:#bbb; font-size:13px; margin-top:46px; }}
  .os {{ display:flex; gap:14px; flex-wrap:wrap; }}
  .os > div {{ flex:1 1 320px; }}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <span class="badge">📍 看房距离助手 · v{version}</span>
    <h1>刷小红书找房时，直接看到通勤距离</h1>
    <p class="sub">安装需要 1 分钟，装一次以后一直有效。支持 Chrome 和 Edge。</p>
  </div>
</header>

<div class="wrap">

  <div class="card">
    <h2><span class="n">0</span>装好之后长这样</h2>
    <figure class="shot"><img src="{img_feed}" alt="信息流角标"><figcaption>刷信息流时，标题下面直接多一行「距公司 3.2km · 🚇32min」</figcaption></figure>
    <figure class="shot"><img src="{img_panel}" alt="通勤详情"><figcaption>点开可以看地铁坐几号线、多久、多少钱，打车预估价，以及最近的地铁站</figcaption></figure>
  </div>

  <h2><span class="n">1</span>安装扩展</h2>

  <div class="os">
    <div class="card">
      <strong>macOS</strong>
      <ol>
        <li>双击同目录下的 <code>一键安装.command</code><br>
            <span style="color:#999;font-size:13.5px">若提示「无法打开，因为来自身份不明的开发者」：右键 → 打开 → 再点「打开」</span></li>
        <li>它会打开 <code>chrome://extensions</code>，并把插件路径复制到剪贴板</li>
        <li>打开页面右上角 <strong>「开发者模式」</strong></li>
        <li>点左上角 <strong>「加载已解压的扩展程序」</strong></li>
        <li>在弹出的窗口按 <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>G</kbd>，粘贴路径（<kbd>⌘</kbd>+<kbd>V</kbd>）回车</li>
        <li>选中 <code>extension</code> 文件夹 → 「选择」</li>
      </ol>
    </div>

    <div class="card">
      <strong>Windows</strong>
      <ol>
        <li>把压缩包解压到一个<strong>不会删</strong>的文件夹（比如 <code>D:\\看房距离助手</code>）</li>
        <li>双击 <code>一键安装.bat</code>（会自动打开扩展页并复制路径）</li>
        <li>打开页面右上角 <strong>「开发者模式」</strong></li>
        <li>点 <strong>「加载已解压的扩展程序」</strong></li>
        <li>在文件夹选择框里，把路径粘贴到地址栏回车，进入 <code>extension</code> 文件夹</li>
        <li>点「选择文件夹」</li>
      </ol>
    </div>
  </div>

  <div class="tip">装好后工具栏会出现一个红色定位针图标。如果你把它收进了「扩展程序」拼图菜单里，可以点拼图图标 → 把 📍 固定在工具栏。</div>
  <div class="tip">⚠️ 这是「未打包扩展」，<strong>不要移动或删除</strong>刚才那个文件夹，否则插件会失效、需要重新加载。</div>

  <h2><span class="n">2</span>第一次用：设置你的地点</h2>
  <div class="card">
    <ol>
      <li>打开 <a href="https://www.xiaohongshu.com/explore" target="_blank">xiaohongshu.com/explore</a>（需要先登录）</li>
      <li>右下角会出现一个红色圆按钮，点开面板</li>
      <li>第一行填备注名，比如 <code>公司</code></li>
      <li>第二行搜地点，比如 <code>国贸三期</code>，点「搜」→ 在结果里点「选它」</li>
    </ol>
    <p style="color:#666;font-size:14.5px;margin-bottom:0">想加健身房、朋友家，就再点一次「+ 地点」。<br>
    卡片上显示的是<strong>第一个地点</strong>的距离；点开详情会列出全部地点。</p>
  </div>

  <h2><span class="n">3</span>怎么用</h2>
  <div class="card">
    <table>
      <tr><th>刷首页信息流</th><td>每张笔记的标题下多一行 <code>距公司 3.2km · 🚇32min</code></td></tr>
      <tr><th>点进笔记</th><td>笔记里提到的小区自动列成清单，按离你远近排序；点一行看详情</td></tr>
      <tr><th>看评论区</th><td>提到小区的评论下面会挂一条距离标签</td></tr>
      <tr><th>主动查</th><td>点右下角红按钮，输入小区名</td></tr>
      <tr><th>划词查</th><td>在笔记正文里选中小区名 → 弹出「查『…』距离」</td></tr>
      <tr><th>收藏</th><td>面板右上角 ★；清单右上角「☆ 收藏全部」；收藏夹里能「复制清单」发微信</td></tr>
    </table>
  </div>

  <div class="card">
    <h2 style="margin-top:0"><span class="n">?</span>常见问题</h2>
    <p><strong>卡片上没出现距离？</strong><br>
    只有标题/正文里出现「XX小区 / XX苑 / XX园 / XX号楼 / XXSOHO」这类名字时才会标注。
    标题是「这下是真全员拿到大芒果了」这种，识别不到小区就不会标注——这是有意的，避免瞎猜。</p>
    <p><strong>距离不太对？</strong><br>
    同名小区很常见，插件会挑最像的一个。点进详情用「高德地图」核对位置；或者划词时把「三区 / 东区」一起选上。</p>
    <p><strong>会卡吗？</strong><br>
    请求都是排队发送、间隔 0.3 秒以上，结果缓存在本地（路线 7 天、小区 14 天），不会刷爆接口。</p>
    <p style="margin-bottom:0"><strong>数据会被上传吗？</strong><br>
    不会。只把小区名发给百度地图查坐标，你填的地点存在浏览器本地，没有账号也没有服务器。</p>
  </div>

  <figure class="shot"><img src="{img_detail}" alt="笔记详情清单"></figure>
  <figure class="shot"><img src="{img_favs}" alt="收藏夹"></figure>

  <div class="card">
    <h2 style="margin-top:0">手机也想用？</h2>
    <p>iPhone 不能往小红书 App 里装插件（系统限制）。同目录的 <code>手机版.html</code> 是一个网页：
    复制笔记文字 → 在手机浏览器打开它 → 粘贴 →「查距离」，同样能看地铁和打车。</p>
  </div>

  <footer>看房距离助手 · 数据来自百度地图公开接口 · 与小红书官方无关</footer>
</div>
</body>
</html>
"""


def build():
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]

    out = os.path.join(DIST, "看房距离助手-v%s" % version)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)

    # 扩展本体
    ext = os.path.join(out, "extension")
    os.makedirs(ext)
    for name in EXT_FILES:
        src = os.path.join(ROOT, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(ext, name))
    for name in EXT_DIRS:
        shutil.copytree(os.path.join(ROOT, name), os.path.join(ext, name))

    # 手机版
    shutil.copy2(os.path.join(ROOT, "mobile", "index.html"), os.path.join(out, "手机版.html"))

    # 教程
    imgs = {p: embed(p) for p, _ in SHOTS}
    html = TUTORIAL.format(
        version=version,
        img_feed=imgs[SHOTS[0][0]],
        img_panel=imgs[SHOTS[2][0]],
        img_detail=imgs[SHOTS[1][0]],
        img_favs=imgs[SHOTS[3][0]],
    )
    with open(os.path.join(out, "安装教程.html"), "w", encoding="utf-8") as f:
        f.write(html)

    # 安装助手
    cmd = os.path.join(out, "一键安装.command")
    with open(cmd, "w", encoding="utf-8") as f:
        f.write(
            '#!/bin/bash\n'
            'DIR="$(cd "$(dirname "$0")" && pwd)/extension"\n'
            'printf "%s" "$DIR" | pbcopy\n'
            'echo ""\n'
            'echo "  看房距离助手 · 安装助手"\n'
            'echo ""\n'
            'echo "  插件路径（已复制到剪贴板）："\n'
            'echo "  $DIR"\n'
            'echo ""\n'
            'echo "  接下来在 Chrome 里："\n'
            'echo "   1. 打开右上角「开发者模式」"\n'
            'echo "   2. 点左上角「加载已解压的扩展程序」"\n'
            'echo "   3. 按 Command+Shift+G，粘贴路径后回车"\n'
            'echo "   4. 选中 extension 文件夹，点「选择」"\n'
            'echo ""\n'
            'open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || open "chrome://extensions/" 2>/dev/null\n'
            'read -n 1 -s -r -p "  按任意键关闭…"\n'
            'echo ""\n'
        )
    os.chmod(cmd, 0o755)

    bat = os.path.join(out, "一键安装.bat")
    with open(bat, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(
            "@echo off\r\n"
            "chcp 65001 >nul\r\n"
            "set DIR=%~dp0extension\r\n"
            "echo %DIR%| clip\r\n"
            "echo.\r\n"
            "echo   看房距离助手 · 安装助手\r\n"
            "echo.\r\n"
            "echo   插件路径（已复制到剪贴板）：\r\n"
            "echo   %DIR%\r\n"
            "echo.\r\n"
            "echo   接下来在浏览器里：\r\n"
            "echo     1. 打开右上角「开发者模式」\r\n"
            "echo     2. 点「加载已解压的扩展程序」\r\n"
            "echo     3. 地址栏粘贴路径后回车，选中 extension 文件夹\r\n"
            "echo.\r\n"
            "start chrome chrome://extensions\r\n"
            "pause\r\n"
        )

    # 打包 zip
    zip_path = os.path.join(DIST, "看房距离助手-v%s.zip" % version)
    if os.path.exists(zip_path):
        os.remove(zip_path)
    base = os.path.dirname(out)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for dirpath, _, filenames in os.walk(out):
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, base)
                z.write(full, rel)

    print("目录：", out)
    print("压缩包：", zip_path, "%.1f KB" % (os.path.getsize(zip_path) / 1024))


if __name__ == "__main__":
    build()
