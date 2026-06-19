# Etsy Seamless Helper 项目进度说明

更新时间：2026-06-19

这份文档记录当前项目状态、代码结构、已经跑通的能力、测试中遇到的问题，以及后续开发重点。后面继续开发时，优先看这份文档和 `docs/etsy-listing-flow.md`。

## 项目目标

这个项目是一个本地 Etsy 上架小助手。

当前方向不是接 Etsy 官方 API 直接发布，而是：

1. 本地 Node helper 读取 Excel 和本地文件。
2. Firefox/AdsPower 浏览器插件注入 Etsy 后台页面。
3. 插件像人工操作一样点击页面、填写字段、打开系统文件选择框。
4. 本地 helper 通过 Windows 原生能力完成鼠标点击和文件选择框粘贴路径。

这样可以复用当前 Etsy 店铺登录态、AdsPower 指纹环境和 Etsy 页面自身流程。

## 当前运行方式

本地 helper：

```powershell
npm.cmd start
```

默认地址：

```text
http://127.0.0.1:8788
```

浏览器插件打包产物在：

```text
dist\
```

当前最新测试包：

```text
D:\Etsy_seamless_helper\dist\etsy-seamless-helper-20260619-231320.xpi
```

AdsPower Firefox 临时加载方式：

1. 打开 AdsPower 对应浏览器环境。
2. 进入：

```text
about:debugging#/runtime/this-firefox
```

3. 点击 `Load Temporary Add-on...`
4. 选择最新 `.xpi` 文件。
5. 打开 Etsy 后台页面：

```text
https://www.etsy.com/your/shops/me/tools/listings
```

或：

```text
https://www.etsy.com/your/shops/me/listing-editor/create
```

页面会自动出现 `Etsy Seamless Helper` 悬浮面板。

注意：Firefox 临时插件重启浏览器后会消失，需要重新加载。

## 主要代码结构

### `server.js`

本地 Node helper，负责：

- 读取配置文件 `config.json` / `config.example.json`
- 读取 Excel 商品数据
- 匹配 SKU 对应的主图、listing 图、视频、下载文件
- 提供本地 HTTP API 给网页插件调用
- 打开系统文件选择框后，把本地文件路径粘贴进去
- 执行 Windows 原生鼠标点击

关键 API：

```text
GET  /health
GET  /api/config
POST /api/config
GET  /api/products?check=1
GET  /api/product/:sku
POST /api/upload-dialog
POST /api/native-click
GET  /file/:sku/:kind
```

`/api/upload-dialog` 当前支持的 `kind`：

```text
main-image
media-main-image
listing-media
listing-video
media-video
listing-images
media-images
media-image-1
media-image-2
...
download-files
```

其中新加的 `media-image-N` 是为了解决 Etsy 一次上传多张 listing 图片不稳定的问题。现在插件会逐张上传 listing 图片。

### `extension/manifest.json`

Firefox 插件配置。

当前注入范围：

```text
https://www.etsy.com/your/shops/me/*
```

这样插件可以同时出现在：

- listings 列表页
- listing create 页面
- listing edit 页面

### `extension/background.js`

插件后台脚本。

作用：

- 接收 content script 的消息。
- 代替 Etsy 页面请求本地 helper。
- 给请求加 `X-Local-Token`。

这么做比 content script 直接 `fetch(http://127.0.0.1:8788)` 更稳定，也更接近参考项目 `etsy-stl-uploader` 的实现方式。

### `extension/content.js`

核心浏览器自动化脚本。

当前能力：

- 自动注入悬浮 UI 面板。
- 刷新并显示 SKU 列表。
- 搜索 SKU / 标题。
- 勾选多个 SKU。
- 单个 SKU 自动填写当前页面。
- 支持批量队列。
- 支持从 listings 页跳转 create 页后的队列恢复。
- 支持“补 Craft type”单独按钮。
- 支持主图、视频、listing 图片、digital files 上传。

上传流程现在是：

1. 上传主图：

```text
media-main-image
```

2. 上传视频：

```text
media-video
```

3. 逐张上传 listing 图片：

```text
media-image-1
media-image-2
...
```

4. 上传 digital download files：

```text
download-files
```

插件会通过页面文字 `Add photos / Add videos / remaining` 判断媒体数量是否到位。

### `public/`

本地 helper 的普通网页 UI。

目前主要用于配置和查看本地数据，不是 Etsy 页面自动化的主入口。

### `scripts/`

辅助测试脚本：

- `smoke-test.js`：本地 API smoke test。
- `observe-etsy.js`：观察 Etsy 页面。
- `etsy-test-listing.js`：Etsy listing 测试辅助。
- `click-etsy-upload.js`：点击上传入口辅助。
- `remove-etsy-downloads.js`：移除下载文件辅助。

## 当前已完成

### 1. 本地 helper 基础修复

已完成：

- 配置归一化。
- 默认配置兜底。
- `ESH_CONFIG_PATH` 支持。
- API 错误更清楚。
- smoke test。
- `.tmp-upload/` 和 `dist/` gitignore。

验证命令：

```powershell
npm.cmd run check
npm.cmd run smoke
```

### 2. AdsPower 连接验证

当前 AdsPower API 信息：

```text
Local API: http://local.adspower.net:50325
Profile: 四方图
Profile ID: k1dk8v9x
```

测试中使用过：

```powershell
ads.cmd get-browser-active -p 50325 -k <API_KEY> k1dk8v9x
```

当前返回过的关键连接信息：

```text
selenium: localhost:49842
marionette_port: 49841
webdriver: C:\Users\ZhuanZ\AppData\Roaming\adspower_global\cwd_global\flower_150\geckodriver.exe
```

### 3. 插件链路

已完成：

- Firefox temporary add-on 方式加载插件。
- Etsy 页面自动注入悬浮面板。
- 插件通过 background 调 helper。
- helper 通过 `/api/native-click` 做真实鼠标点击。
- helper 通过 `/api/upload-dialog` 操作 Windows 文件选择框。

### 4. 1A_003 测试

测试 SKU：

```text
1A_003
```

已确认：

- 主图可以上传。
- 视频可以上传。
- listing 图片一次多图上传不稳定，已改成逐张上传。
- digital files 可以上传，且保留原始文件名：

```text
1A_003_seamless.jpg
1A_003_single.jpg
```

- Tags 可以一次性逗号分隔输入，并显示：

```text
All 13 used
```

- How it's made 选择：

```text
I did
A supply or tool to make things
With an AI generator
```

### 5. Craft type 修复

目标 Craft type：

```text
Drawing & drafting
Painting
Paper stamping
Party & gifting
Printing & printmaking
```

遇到的问题：

- Etsy 下拉框会显示候选项。
- 旧逻辑用整段文本判断是否已选，会把候选项误认为已选择。
- 结果页面只选中部分项，比如只选了：

```text
Drawing & drafting
Painting
```

当前修复：

- `selectedCraftTypes()` 只看 `Craft type` 到 `Occasion/Holiday/Price and inventory` 之间的已选区域。
- 如果出现候选项如 `3D printing`、`Paper quilling`、`Plastic canvas`，会截断候选区域，避免误判。
- 每次选择前清空 typeahead 输入框。
- 新增面板按钮：

```text
补 Craft type
```

如果当前页面 Craft type 没选全，可以直接点这个按钮。

## 当前 UI 状态

插件悬浮面板已缩小。

当前尺寸方向：

- 宽度：`360px`
- 产品表高度：`150px`
- 日志高度：`110px`
- 按钮和输入框 padding 缩小

面板功能：

- `测试连接`
- `刷新列表`
- SKU / 标题搜索
- `全选可上架`
- 勾选单个 SKU
- `填完后保存草稿并继续下一个`
- `只跑当前页第一个`
- `开始选中队列`
- `停止`
- `补 Craft type`

## 已知问题

### 1. Firefox temporary add-on 会残留多个版本

如果连续加载多个 xpi，旧插件可能也还在，导致旧 UI 先注入。

现象：

- 页面上看到旧版小面板。
- 新版面板没有出现。
- 功能表现和代码不一致。

解决：

- 在 `about:debugging#/runtime/this-firefox` 卸载旧 temporary add-on。
- 只保留最新 xpi。
- 刷新 Etsy 页面。

### 2. Listing 图片不能一次多图上传

已验证 Etsy/AdsPower Firefox 下，一次上传 8 张 listing 图片会不稳定：

- helper 日志显示文件已提交。
- 页面短暂显示多张。
- 随后数量回落，只剩主图。

当前策略：

- 改为逐张上传。
- 每张上传后等待图片数量加 1。

### 3. 视频等待逻辑要依赖 Etsy 文本格式

Etsy 页面不是一行显示：

```text
Add videos 1 remaining
```

而是可能显示成多行：

```text
Add videos
Add videos
1 remaining
```

当前已改为按行解析 `remaining`。

### 4. 多个未保存 create 页面会影响测试

测试时如果开了很多未保存 create tab，WebDriver 导航有时会卡住。

建议：

- 手动关闭旧的未保存测试 tab。
- 或保存草稿/取消后再开干净 create 页。
- 自动化测试前尽量只保留一个 Etsy create 页面。

### 5. 还没有自动点击 Publish

当前设计是安全优先：

- 自动填表。
- 自动上传。
- 停在页面等待人工检查。

后续如果要自动发布，建议先加：

- 完整字段校验。
- 图片/视频数量校验。
- digital files 校验。
- tags/craft type 校验。
- preview 或 save draft 阶段。

## 当前测试数据位置

用户提供的测试根目录：

```text
C:\Users\ZhuanZ\Downloads\上架
```

重要子目录按当前 helper 逻辑匹配：

```text
上架主图
上架Listing
上架文件
```

`1A_003` 示例文件：

```text
上架主图\1A_003_main.jpg
上架Listing\1A_003\1A_003_01.jpg
上架Listing\1A_003\1A_003_02.jpg
...
上架Listing\1A_003\1A_003_video.mp4
上架文件\1A_003\1A_003_seamless.jpg
上架文件\1A_003\1A_003_single.jpg
```

## 常用开发命令

检查语法：

```powershell
npm.cmd run check
```

Smoke test：

```powershell
npm.cmd run smoke
```

启动 helper：

```powershell
npm.cmd start
```

打包 Firefox xpi：

```powershell
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$zip="dist\etsy-seamless-helper-$stamp.zip"
$xpi="dist\etsy-seamless-helper-$stamp.xpi"
Compress-Archive -Path extension\* -DestinationPath $zip -Force
Copy-Item $zip $xpi -Force
Get-Item $xpi | Select-Object FullName,Length
```

检查 AdsPower 当前环境：

```powershell
ads.cmd get-browser-active -p 50325 -k <API_KEY> k1dk8v9x
```

连接 geckodriver：

```powershell
& "C:\Users\ZhuanZ\AppData\Roaming\adspower_global\cwd_global\flower_150\geckodriver.exe" --connect-existing --marionette-port 49841 --port 4445 --log warn
```

停止 geckodriver：

```powershell
taskkill /IM geckodriver.exe /F
```

## 下一步建议

优先级从高到低：

1. 在干净 create 页重新完整跑 `1A_003`，确认逐张 listing 图片可以稳定到 `9/9`。
2. 确认 `补 Craft type` 在当前页面可补到 `All 5 selected`。
3. 给插件增加“当前页状态检查”按钮，显示：
   - 图片数
   - 视频数
   - digital files
   - tags
   - craft type
   - title/price/sku
4. 批量队列先默认只填一个，不自动保存草稿；确认稳定后再打开“保存草稿并继续下一个”。
5. 把面板日志做成更短的阶段状态，避免长日志占用屏幕。
6. 后续再考虑自动 Save draft，最后再考虑 Publish。

