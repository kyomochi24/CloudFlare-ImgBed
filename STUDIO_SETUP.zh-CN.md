# 浅浅丘的甜品屋：部署与使用

这套扩展在原 CloudFlare-ImgBed 的 Cloudflare Pages 部署上新增独立的 `/studio/` 用户小屋和 `/studio/admin.html` 审核页。原管理员后台仍在 `/dashboard`。根网址会打开新小屋。请先在原管理员后台设置管理员账号和密码，再启用下列改动。

## 上线前的准备

1. 在 Cloudflare Pages 项目中确认已有 R2 绑定 `img_r2`、原项目的 KV 绑定 `img_url`（或原有数据库绑定）和管理员账号。新用户系统还要求一个 D1 数据库，绑定名必须是 `img_d1`。可以复用原来的 D1；如果原来仅用 KV，可以新建 D1 专供用户系统使用。**不要移除原有 KV 绑定**，旧图片元数据仍在其中。
2. 在 D1 的控制台执行 [`database/migrations/studio.sql`](database/migrations/studio.sql)。这只创建六张 `studio_` 表，不改原图床记录。也可以用 Wrangler 对对应数据库执行：`npx wrangler d1 execute 数据库名 --remote --file=database/migrations/studio.sql`。
3. 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建应用，到 OAuth2 页面取得 Client ID 和 Client Secret。Redirect URI 填 **`https://771553.xyz/api/studio/oauth/callback`**，需要的 scopes 是 `identify` 和 `guilds`。这里不需要 Discord Bot；皮丘和皮卡丘仅是图床站内等级。
4. 已将你给的两个 Discord 服务器 ID `1291925535324110879` 与 `1379304008157499423` 设为默认放行范围；加入其中任意一个即可登录。如果今后更换社区，可在 Cloudflare Pages 设置 `DISCORD_GUILD_IDS` 覆盖默认值，多个 ID 用英文逗号隔开。复制服务器 ID 的方法是「用户设置 → 高级 → 开发者模式」，再右键服务器图标。
5. 在 Cloudflare Pages → 项目 → 设置 → 变量和机密中配置：

   | 名称 | 类型 | 值 |
   | --- | --- | --- |
   | `DISCORD_CLIENT_ID` | 文本 | Discord 应用 Client ID |
   | `DISCORD_CLIENT_SECRET` | 机密 | Discord 应用 Client Secret |
   | `DISCORD_GUILD_IDS` | 文本，可选 | 覆盖默认的两个服务器 ID；多个用逗号隔开 |
   | `STUDIO_IMPORT_HOSTS` | 文本，可选 | 允许导入图片的来源域名，默认 `iili.io,i.postimg.cc` |

6. 提交代码到连接 Cloudflare Pages 的仓库，确认项目构建输出目录仍为 `frontend-dist`。部署完成后，在浏览器依次验证 `/studio/`、`/studio/admin.html` 和原后台 `/dashboard`。

### 用 GitHub Desktop 上传这次改动

如果你用的是 GitHub 与 Cloudflare Pages 自动部署，可以按下面操作，不用在网页里逐个上传文件：

1. 安装 GitHub Desktop，登录你 fork 所在的 GitHub 账号。
2. 选择「File → Clone repository」，克隆 `kyomochi24/CloudFlare-ImgBed`。记下克隆到电脑上的目录。
3. 解压交付的「浅浅丘的甜品屋-改动文件.zip」，把里面的文件和文件夹**合并复制**到刚才克隆的项目根目录；出现同名文件时选择覆盖。不要删除仓库里的其他文件。
4. 在 GitHub Desktop 的 Changes 页面确认有 `frontend-dist/studio/`、`functions/api/studio/`、`database/migrations/studio.sql` 等改动，填一个说明，点击「Commit to …」，再点「Push origin」。如果原先 Pages 已连到这个分支，Cloudflare 会开始新部署。
5. 在 Cloudflare Pages 的 Deployments 查看部署结果。上线前先完成上面的 D1 迁移和变量配置。若构建失败，先不要改 DNS，查看部署日志。

`DISCORD_CLIENT_SECRET` 只填在 Cloudflare 的机密变量里，不要写进仓库、截图或发给别人。**尚未创建 Discord 应用时，先用管理员创建的专用账号测试；Discord 登录按钮会保持不可用。**

## 第一次使用

1. 在 `/adminLogin` 登录**原图床管理员账号**，再打开 `/studio/admin.html`。旧版 `/login` 会跳转到新的用户小屋。
2. 可以先创建一个专用账号，自行保管并发给用户；这个账号不需要 Discord。管理员也可以把它设成皮卡丘。
3. 配好 Discord 变量和服务器 ID 后，普通用户打开 `/studio/`，用 Discord 授权登录。只有授权结果显示已加入允许的服务器才会创建皮丘账号。
4. 皮丘累计可保存 **100 MiB**。删除图片会释放空间。图片不会因时间到期而自动删除。
5. 用户在个人小屋填写任意位数的 Discord 数字 ID 与作品名即可提交审核；其余字段可留空，成功后按钮旁显示「已提交」。管理员在站长小本本中审核。通过后升级为皮卡丘，每个**北京时间自然月**可上传 **1 GiB**；上个月上传的图片仍保留。删除图片不返还当月上传额度。
6. 在相册里点击「上传原图」，或拖入旁边的小区域上传图片。点击图片可依次选中并显示 1、2、3 等编号，然后一键复制已选图链。美化搬家助手可选择或拖入 `.json`，也可点击「清空当前选择」重新选文件；把里面的图片逐张导入当前相册，再点「下载替换后的 JSON」。原文件保持不变；某条图链搬运失败时，新 JSON 中该条图链仍使用旧地址。单张图片最大 25 MiB，单个 JSON 最大 5 MiB。

## 使用边界

- 旧版共用用户口令和旧版用户会话已不能调用上传接口，这样不能绕过个人额度。原管理员会话及管理员 API Token 仍可使用旧接口。
- 相册目录仅登录用户可见，**图片图链是公开链接**；知道图链的人可以访问。请勿存放私密图片。
- 新上传图片保存在 R2，原字节写入，不调用压缩。出于安全考虑，这个入口接受 PNG、JPEG、WebP、GIF、AVIF、BMP，不接受可执行脚本的 SVG。网站字体已下载并自托管于 `/studio/bubble.woff2`。
- 页面壁纸按屏幕宽度切换：电脑端使用你提供的草莓条纹图，手机端使用粉色格纹图。兔子插画和壁纸继续从你现有图床的公开链接读取；请保留这些原图片。
- JSON 导入只识别带图片扩展名的 HTTPS 链接；CSS、字体和无扩展名链接会留在原位。图片来源必须属于 `STUDIO_IMPORT_HOSTS` 允许列表。作品名称示例可填写「像素甜点屋」。
- Discord 授权需要用户浏览器能够访问 Discord；中国大陆网络能否直连不能由图床或域名设置保证。管理员发放的本地账号是无需 Discord 的替代入口。Cloudflare 在中国大陆的直连速度与可用性也需要在实际运营商网络上测试。
- 当前实现只在 Discord **登录时**检查服务器成员资格，会话有效期七天；已登录用户离开服务器不会立即退出。若要实时撤销，可以进一步接入 Discord Bot 或缩短会话有效期。
- 原管理员文件管理器可以看到新文件，但请在用户相册页面删除 `studio/` 图片，避免绕过配额统计。建议先在测试环境部署，验证后再接入正式域名。
