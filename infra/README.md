# 有宠有邻 · 部署基础

这里保存微信部署所需的结构清单、非机密配置模板和发布工具。项目已经配置真实 AppID，云环境仍待配置；文件与自动测试不能证明云端已经开通。

## 数据库

`database.schema.json` 是 20 个集合、索引和拒绝客户端直接读写规则的统一清单。`cloudfunctions/setup/schema.json` 必须与它一致，项目检查会发现不同步。字段方向使用可读的 `asc/desc`；清单不是微信控制台的直接导入格式。

`setup` 云函数提供 `inspect/createMissing`：只能通过服务端密钥调用，只检查或创建清单中的空集合，不写用户资料，不自动声明数据库权限已经配置完成。创建结束后，仍须在微信云开发控制台为每个集合设置 `{"read":false,"write":false}`、建立清单索引并实际验证拒绝访问。随后才可为业务函数设置 `DATABASE_RULES_CONFIRMED=true`。

初始化函数需要单独的 `SETUP_SECRET`（至少 32 字节随机密钥），拒绝来自带微信用户身份的客户端调用。部署并使用完毕后停用该函数或移除其密钥。这个工具不提供删库、清库或覆盖用户数据操作。

## 图片存储

`storage-policy.json` 描述必须实现并测试的访问边界，**不是可直接发布的 CloudBase 安全规则语法**。平台版本、存储权限和服务端上传文件归属需在真实环境核对。待审核副本必须不能被客户端读取或修改，已审核副本必须不能被客户端改写；不能只凭路径随机或文件摘要判断已经安全。

图片默认关闭。同步审核需要平台仍支持对应接口；异步审核需要配置微信安全模式消息推送、Token、EncodingAESKey 和绑定 AppID。完成真实存储权限验证后，才开启 `MEDIA_QUARANTINE_LOCK_CONFIRMED=true`。接口权限或回调配置失败时不得绕过审核开放图片。

## 配置和打包

1. 将 `deployment.example.json` 复制为本机 `deployment.local.json`，填写真实 AppID、云环境、运营资料、城市和片区。这个文件不能含密钥；工具只接收明确列出的字段。
2. `policyApproved` 表示运营方已经检查具体条款与资料，不能替代平台审核或适用法规核对。未完善时保持 `false`，真实注册会显示配置未完成。
3. `secrets.env.example` 只列出变量名。手机号摘要密钥、维护密钥、云访问凭据和微信上传私钥通过秘密管理或进程环境提供，不写入小程序源码、发布包或聊天。
4. 运行 `npm run release:plan -- infra/deployment.local.json` 查看缺项。
5. 运行 `npm run release:bundle -- infra/deployment.local.json` 生成一个新的候选目录。未配置完整时仍可生成审阅包，但不能执行上传。
6. 运行 `npm run release:check -- 候选目录`。工具在候选包内执行项目检查与全部测试，并记录文件摘要；修改候选代码后必须重新打包、测试。

候选包内 `infra/cloud-settings.json` 包含非机密云环境变量和社区初始化参数。数据库权限确认、隔离区权限确认默认仍为 `false`，不会因为打包或测试通过就自动变成已验证。

`node scripts/generate-secrets.js` 可首次生成本机 `.env.local`，文件权限为仅当前用户读写，已有文件绝不覆盖，密钥值不写入输出。当前任务已准备该文件；它被版本管理及发布打包排除。请通过服务端秘密管理配置对应值，并私下备份；手机号摘要密钥投入使用后不能随意轮换。工具不会生成或替代微信上传私钥、腾讯云账号凭据。

## 微信上传

本地开发与测试使用 Node.js 22.13+，推荐 24；云函数使用平台支持的 Node.js 18+。首次使用发布工具，在 `tools/wechat` 安装其独立依赖。这些 SDK 不进入小程序主包。本仓库离线检查不安装或调用这些远端 SDK；配置真实账号后需完成首次连接验证并保留依赖锁文件。

微信代码上传需要在微信后台开启对应能力、配置必要的 IP 白名单，并把上传私钥保存在候选包目录之外，通过 `WECHAT_PRIVATE_KEY_PATH` 指定。

```sh
node scripts/release.js preview 候选目录
node scripts/release.js upload 候选目录
```

`preview` 请求微信生成预览二维码；`upload` 只上传微信开发版本，不自动提交审核或公开发布。云函数需要另行部署：在微信开发者工具选择真实云环境，上传并部署 `community`（以及首次初始化需要的 `setup`），安装云端依赖，设置环境变量。未完成云部署的前端即使上传成功，也不能进行真实多人业务。

## 数据库管理与定时维护

安装 `tools/wechat` 中的云 SDK，并为受控服务端进程配置最小权限的腾讯云凭据：

```sh
node scripts/cloud-admin.js inspect-schema infra/deployment.local.json
node scripts/cloud-admin.js create-collections infra/deployment.local.json
node scripts/cloud-admin.js maintenance infra/deployment.local.json
```

维护入口需要 `MAINTENANCE_SECRET`，拒绝客户端身份，不根据请求正文的 `Type/TriggerName` 判断可信。维护任务按有限批次重试站内通知、清理过期上传和频次记录；照片被帖子使用时不清理，失败可重试。将第三条命令配置到你控制的云任务调度器，例如每 5 分钟执行一次，凭据从调度器的秘密管理注入。当前仓库没有替你开通或启动远端计划任务。

在小程序「我 → 运行状态」可以查看配置状态、通知积压及最近维护结果。云数据库的自动备份、保留期限、资源预算告警和密钥访问权限也需在真实云环境中配置；本项目不会擅自创建收费资源或生成虚构的备份成功记录。

## 验收边界

本地测试含真实 SQLite 文件的持久化、重启和事务回滚测试，验证同一套业务服务的多账号数据流。SQLite 仅是测试适配器，生产仍使用微信 CloudBase；它不代替 CloudBase 的权限、索引、事务和容量验收。

部署后至少用两个普通微信账号和一个管理员账号验证：注册、发帖、跨账号评论和消息、宠物公开范围、报名并发、审核等待/拒绝/重试、举报、注销及维护重试。正式上线所需主体、类目、备案、政策及平台审核，以实际账号后台要求为准。

`scripts/wechat-smoke.js` 提供微信实机联调辅助函数。先在正常页面完成各账号真实核验，再在微信开发者工具控制台加载此函数：A 调用 `runWechatSmoke(wx,{step:'publish'})`，把返回的测试帖子编号用于 B 的 `reply`，然后 A 执行 `verify`。页面人工确认后由 A 执行 `cleanup`。辅助函数不伪造身份、不绕过手机号核验，只清理明确标记且属于本人的部署测试帖。分享给普通用户前，还需人工验收真实图片审核及手机上的界面交互。
