# 8组观察图解与2条短视频

本批在原250条目录上追加10条，完整目录为58条知识图文、197条照片、5条视频，共260条。8组图解通过 `imagePhotoIds` 引用22张已有核验图片，分别观察兔子、鸟、孔雀鱼、美西螈、虾、守宫、龙猫、豚鼠。每组正文逐图对应，并说明它们来自不同个体或场景，不构造用户经历、连续拍摄、成长前后或医疗结论。独立照片数仍为197。

2026-09-30复核的是已保存的来源元数据、原片、图片和配文，没有重新请求来源网页。组图沿用原图的来源与 `checkedAt`；新视频的 `checkedAt` 表示当日离线证据复核，其含义在 `sourceEvidence.checkedAtMeaning` 中明确记录。所有复核输入和产物的SHA-256保存在 [review/evidence.json](review/evidence.json)。许可仍为原始CC0或公有领域记录，署名与来源保留在内部元数据。

视频 `101613615` 为孔雀鱼游动，`134636343` 为栉水母漂动。两条均截取原片前8秒，宽480像素，20 fps、H.264 MP4、无音轨，单条低于300 KiB。每0.5秒抽帧检查，并单独查看封面；封面分别取原片3.5秒和5秒，保存在主包 `/assets/curated-poster/`，播放文件保存在 `/media/clips/` 分包。原有3段视频字节不变，旧目录URL通过运行时映射兼容到分包位置。

离线重建：

```sh
python3 scripts/prepare-content-extension.py
npm run content:validate
npm run content:build
node --test tests/content-import.test.js tests/content-extension.test.js tests/content-serialization.test.js tests/content-catalog.test.js
node scripts/audit-content-runtime.js
node scripts/check-project.js
```

`--prepare-media` 仅重新编码本地原片和提取封面。若结果哈希变化，需重新检查实际画面、更新复核记录后才可生成清单。普通重建会拒绝任何与复核记录哈希不符的素材或配文，也会拒绝覆盖当前目录中额外的新条目或已经修改的原250条。

`baseline-250.json` 与 `baseline-runtime-250.json` 是扩充前快照。自动校验逐条深比较，确保原250条的ID、正文、图片、视频URL、来源与署名保持一致。运行数据审计只使用隔离的内存Map，不访问开发者工具、微信真实存储或云端；浏览器播放和真机发布由其他验证步骤负责。
