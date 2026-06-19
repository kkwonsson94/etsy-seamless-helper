# Etsy Seamless Helper 3.0

这是四方连续图上架用的本地小助手 3.0。

当前版本先做本地输入和 API 跑通，不直接处理 Etsy 页面细节。

标准输入目录：

```text
上架/
├─ xxx_SEO.xlsx
├─ 上架主图/
├─ 上架Listing/
└─ 上架文件/
```

每个 SKU 的文件规则：

```text
上架主图/1A_001_main.jpg
上架Listing/1A_001/1A_001_01.jpg
上架Listing/1A_001/1A_001_video.mp4
上架文件/1A_001/1A_001_seamless.jpg
上架文件/1A_001/1A_001_single.jpg
```

启动：

```powershell
npm install
npm start
```

默认地址：

```text
http://127.0.0.1:8788
```

主要 API：

```text
GET  /health
GET  /api/config
POST /api/config
GET  /api/products?check=1
GET  /api/product/:sku
GET  /file/:sku/:kind
POST /api/upload-dialog
```
