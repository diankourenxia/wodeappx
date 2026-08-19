export type WodeAppToolDocEntry = {
  readonly title: string;
  readonly whenToUse: string;
  readonly requiredFields?: readonly string[];
  readonly rules?: readonly string[];
  readonly examples?: readonly string[];
};

const TOOL_DOCS: Readonly<Record<string, WodeAppToolDocEntry>> = {
  wodeapp_sidebar_agent_save: {
    title: "保存侧栏智能体",
    whenToUse: "用户要生成/创建/保存一个智能体，或已经发布了对应站点、需要把站点写进智能体信息时。",
    requiredFields: ["name"],
    rules: [
      "智能体=侧栏名字+策略+对应站点，不是 Skill.md。",
      "创建或发布 runtime 项目后必须回写 projectId 与 launchUrl。",
      "保存后侧栏立刻更新，禁止让用户刷新或重启。",
      "有对应站点时 samplePrompt 里写上这个智能体的项目 URL。",
    ],
    examples: [
      'name: "PH 管理", projectId: "80d37c53", launchUrl: "https://xn--vxup8bh7b382a-2.wodeapp.cn"',
    ],
  },
  wodeapp_product_save: {
    title: "保存商品到商品库",
    whenToUse: "用户要入库/上架/保存商品档案，或更新已有商品记录时。",
    requiredFields: ["name"],
    rules: [
      "对话上传图传 selectedImageIds（与图片库同一套会话图 ID）；工具内统一上传并校验。",
      "按用户意图选货架：商品档案用本工具，通用参考图用 wodeapp_image_asset_save。",
      ">12 张只问用户一次，再传选中 ID；禁止自动补图与循环重试。",
      "media 可选，优先 {imageId,name}。",
    ],
    examples: [
      'selectedImageIds: ["img_01","img_03","img_08"]',
    ],
  },
  product_save: {
    title: "保存商品到商品库",
    whenToUse: "同 wodeapp_product_save。",
    requiredFields: ["name"],
    rules: ["完整规范见 wodeapp_product_save。"],
  },
  wodeapp_image_asset_save: {
    title: "保存图片库素材",
    whenToUse: "用户要把会话图或参考图存进图片库，或远端分镜需要先拿到 HTTPS。",
    requiredFields: ["name"],
    rules: [
      "优先传 selectedImageIds（与 product_save 同一套会话图 ID）。",
      "也可传 imageUrls：https://、本机路径、file://、附件短名；禁止 data:image。",
      "已有 https:// 直接复用，禁止重复上传。",
      "远端分镜必须立刻有 HTTPS 时传 requireHttps=true。",
    ],
    examples: [
      'selectedImageIds: ["img_02","img_05"]',
      'imageUrls: ["https://..."] + requireHttps: true',
    ],
  },
  image_asset_save: {
    title: "保存图片库素材",
    whenToUse: "同 wodeapp_image_asset_save。",
    requiredFields: ["name"],
    rules: ["完整规范见 wodeapp_image_asset_save。"],
  },
  wodeapp_batch_image_prepare: {
    title: "打开图片工作室（仅准备）",
    whenToUse: "用户要打开/预填图片工作室或第三栏，且不要立即生图扣费时。",
    rules: [
      "只保存草稿并打开工作室，不执行生成、不传 model。",
      "真正生图用 product_visual_batch_image_run 或 ai_generate_image。",
      "productImages/referenceImages 须为可远端读取的 HTTPS。",
    ],
  },
  product_visual_batch_image_run: {
    title: "批量商品生图",
    whenToUse: "用户明确要求生成商品主图/套图/电商图且不需要仅打开工作室时。",
    rules: [
      "productImages 必填且须为 HTTPS；缺 HTTPS 时先用 selectedImageIds 走 product_save 或 image_asset_save 同步。",
      "同主题 N 张：一个 creativeType + iterCount=N。",
      "N 个不同卖点：N 个 task-scoped creativeTypes，skipPlanner=true。",
      "复制附件【SKU 保真锁定】到每个 promptSuffix；不要调用 capability 预检工具。",
    ],
  },
  video_storyboard: {
    title: "视频分镜工作台",
    whenToUse: "多条/批量商品短视频/多段/分镜/TVC/超长成片，或 N 条×每条在模型上限内；短剧出片也走这里。首包：wodeapp_video_storyboard_open；大批量追加/改镜：wodeapp_video_storyboard_update。单条且在模型上限内用 video_generate。",
    requiredFields: ["scenes"],
    rules: [
      "首包调用 wodeapp_video_storyboard_open；后续同一 shareDoc 的增量用 wodeapp_video_storyboard_update（只传本批新增/修改 scenes，≤25/次），不要循环 video_generate，不要 curl /video/tasks。",
      "脚本可视化与视频并列：scriptFrameUrl=单帧、nineGridUrl=九宫格/六宫格、videoRefs=视频；用 previewMode（frame|nineGrid|video）切换展示。subjects 可带 assetId（Visual Bible）。",
      "短剧剧本编辑用 wodeapp.short_drama.open；出片仍走本视频分镜工作台。商品短视频/带货视频禁止走短剧智能体或 wodeapp-short-drama-factory。",
      "scenes[]：用户要 N 段/N 条就传 N 项；每项 prompt 用 [subject名] 引用参考图。",
      "多集/分组（工作台「新建分组」）：同一 shareDoc 内用 groups[{id,title}] + scene.groupId（一集一组；别名 group/episode 也可）。用户说「同一项目不同分组」= 1 个 shareDoc + 多个 groups，不是每集新建 shareDoc，也不是 create_page/update_page 改站点页面。",
      "追加集/分组或修参：用 wodeapp_video_storyboard_update + 同一 shareDocId；禁止为每集开新 pvs_*，禁止把分组做成站点多页面索引，禁止全量重推已有 scenes。",
      "分镜/payload 内容较多时（多集 JSON、scene_payload / tool_call_payload）：优先 openwork_file_extract_text(offset,maxChars) 分段读，hasMore 再续；或 grep 按 groupId/E0N/name 只看本批要改的集。小文件可直接 read。",
      "若工具返回 groupCount=0，说明没写上 groups/groupId（传 group 会被映射，但不要只开新 shareDoc）；应复用已有 shareDocId 用 update 重推。",
      "勿传 model / scene.model（已忽略）；平台默认 Seedance 2.0 Mini，单镜 4–15s。更长必须拆条并重写 prompt 时间轴。",
      "prompt 内「0-N秒」不得超过该条 duration，否则工具会拒收并要求重写。",
      "真人/角色参考图用 ai_generate_image 且 model=seedream-5.0；不要用默认图模冒充角色资产。",
      "subjects[].name 必须与 prompt 里 [name] 逐字一致；imageUrl 须为 https://。",
      "传 productId 时动作自动取商品图；迭代修参必须带 shareDocId。",
      "本地/file/附件缺 https 时先 wodeapp_image_asset_save({ selectedImageIds 或 imageUrls, requireHttps:true })；已有 https 直接复用。",
      "不要把视频 URL 写入 productImages；不自动开跑渲染。",
    ],
    examples: [
      'groups: [{id:"ep-1",title:"第1集"},{id:"ep-2",title:"第2集"}]',
      'scenes: [{name:"1-1",groupId:"ep-1",orderInGroup:0,prompt:"..."},{name:"2-1",groupId:"ep-2",orderInGroup:0,prompt:"..."}]',
      'subjects: [{name:"模特上半身",type:"character",imageUrl:"https://..."},{name:"阿尔法蛋 S1",type:"prop",imageUrl:"https://..."}]',
      'scenes[].prompt: "[模特上半身]手持[阿尔法蛋 S1]面对镜头口播"',
      'update: {shareDocId:"pvs_...", scenes:[{name:"11-1",groupId:"G11",prompt:"..."}]}  // 只传本批',
    ],
  },
  update_page: {
    title: "更新站点页面",
    whenToUse: "已有 project/page，要改标题、路径或短 JSON；本地 HTML 整页导入优先用 wodeapp_page_import_from_file。",
    requiredFields: ["pageId"],
    rules: [
      "本地 HTML/大 CustomCode：先 write 文件，再 wodeapp_page_import_from_file({projectId,pageId,sourcePath})；不要把文件内容塞进 update_page.config。",
      "禁止把 server/data/template-configs.json 或其它整站模板源码一次性塞进 config（易 finish=length / unavailable tool 'invalid'）。",
      "出现 length/invalid 后：勿原样重试大 payload；改走 wodeapp_page_import_from_file 或 ai_generate_page，成功后仍要 publish_project。",
      "新建自定义站/备忘录/表单/清单：走 ai_generate_page 写完整组件；禁止用本工具堆 Hero + SmartForm + SmartTable。",
      "工具返回是摘要（sectionsCount/sectionTypes/customCodeChars），不含完整 code。",
    ],
    examples: [
      'write "内蒙古自驾线路图.html" → wodeapp_page_import_from_file({projectId, pageId, sourcePath:"内蒙古自驾线路图.html"})',
      '仅改标题: {pageId, title:"…"}',
    ],
  },
  wodeapp_page_import_from_file: {
    title: "从本地 HTML 导入页面",
    whenToUse: "本地已有 HTML（write/用户文件），要挂成可发布 CustomCode 页。",
    requiredFields: ["projectId", "sourcePath"],
    rules: [
      "只传路径：host 读盘后调 import-html；禁止把 HTML 粘进工具参数或 update_page.config。",
      "已有页传 pageId；新建页传 path + title。",
      "成功后看返回 sectionsCount/customCodeChars，再 publish_project。",
    ],
    examples: [
      '{projectId:"…", pageId:"…", sourcePath:"内蒙古自驾线路图.html"}',
      '{projectId:"…", path:"/map", title:"线路图", sourcePath:"/abs/path/map.html"}',
    ],
  },
  publish_project: {
    title: "发布项目",
    whenToUse: "页面内容已写好（ai_generate_page / wodeapp_page_import_from_file / 短 update_page 成功）后上线。",
    requiredFields: ["projectId"],
    rules: [
      "create_project 成功 ≠ 已发布；空 sections / 仅改 title 后不要宣称发布成功。",
      "先确认 import_from_file / ai_generate_page / update_page 真正写入内容，再 publish_project，并核验返回的 URL。",
    ],
  },
  "wodeapp-platform_update_page": {
    title: "更新站点页面",
    whenToUse: "同 update_page。",
    requiredFields: ["pageId"],
    rules: ["完整规范见 update_page。"],
  },
  "wodeapp-platform_publish_project": {
    title: "发布项目",
    whenToUse: "同 publish_project。",
    requiredFields: ["projectId"],
    rules: ["完整规范见 publish_project。"],
  },
  "wodeapp.video_storyboard.open": {
    title: "视频分镜工作台",
    whenToUse: "同 video_storyboard / wodeapp_video_storyboard_open。",
    requiredFields: ["scenes"],
    rules: ["完整规范见 video_storyboard。"],
  },
  wodeapp_video_storyboard_open: {
    title: "打开多条/分镜视频（一级工具）",
    whenToUse: "同 video_storyboard。新建首包入口。",
    requiredFields: ["scenes"],
    rules: ["完整规范见 video_storyboard。大批量追加改用 wodeapp_video_storyboard_update。"],
  },
  "wodeapp.video_storyboard.update": {
    title: "增量更新分镜视频",
    whenToUse: "已有 shareDocId，需要追加集/分组、改单镜 prompt、补 subjects；或单次 scenes 过大需分批写入。",
    requiredFields: ["shareDocId"],
    rules: [
      "必填 shareDocId；scenes 与 groups 至少传一类。",
      "只传本批新增或要改的 scenes（≤25）；同名/同 id 合并并保留 videoRefs，新名追加。",
      "禁止把已有全集 scenes 再塞一遍。",
      "内容多时更新前分段/抽样读本批相关镜（openwork_file_extract_text 或 grep groupId/E0N）；小改动可直接读。写入仍只传本批 delta，勿把未改旧镜整包带回。",
      "完整规范见 video_storyboard。",
    ],
  },
  wodeapp_video_storyboard_update: {
    title: "增量更新分镜视频（一级工具）",
    whenToUse: "同 wodeapp.video_storyboard.update。",
    requiredFields: ["shareDocId"],
    rules: [
      "完整规范见 video_storyboard / wodeapp.video_storyboard.update。",
      "内容多时更新前分段/抽样读本批相关镜（openwork_file_extract_text 或 grep groupId/E0N）；小改动可直接读。写入仍只传本批 delta，勿把未改旧镜整包带回。",
    ],
  },
  "wodeapp.video.generate": {
    title: "单条视频生成",
    whenToUse: "用户明确要求生成单条短视频/图生视频/参考视频运动迁移/首尾帧运镜时（平台默认≤15s；勿传 model）。用户要 MiniMax / H3 / 海螺官方时 provider 传 \"minimax\"（默认 MiniMax-H3，支持参考视频，4–15s）。",
    requiredFields: ["prompt"],
    rules: [
      "必传 durationSec（用户指定时长；未指定默认 15）。",
      "勿传 model（已忽略）；平台默认 Seedance 2.0 Mini，单段≤15s；更长拆多段。",
      "MiniMax：provider=\"minimax\" → MiniMax-H3（官方 V2，4–15s，768P/2K，支持 omni/referenceVideos）。可用引擎以 GET /runtime-server/api/video/tasks/providers 与 catalog 返回为准。",
      "参考视频：传 referenceVideos（HTTPS 可播视频 URL，通常 mp4；GIF 须先转视频再上传）。有值时默认 taskType=omni；Seedance/auto 或 minimax(H3) 均可。",
      "首尾帧运镜：referenceImages 按起止顺序传两张，并设 taskType=firstlast。",
      "默认 wait=true；超时后用 video_task_status。",
      "多条/批量/多段/分镜用 wodeapp_video_storyboard_open；大批量追加用 wodeapp_video_storyboard_update。",
    ],
  },
  "wodeapp.video.status": {
    title: "查询单条视频任务",
    whenToUse: "video_generate 超时仍 processing、复查旧 taskId、或 wait=false 之后轮询 videoUrl。",
    requiredFields: ["taskId"],
    rules: [
      "未完成应继续轮询本工具直到 succeed/failed，不要停下来让用户自己追问。",
      "成功拿到 videoUrl 后一般已自动写入生成历史。",
    ],
  },
};

const ALIASES: Readonly<Record<string, string>> = {
  sidebar_agent_save: "wodeapp_sidebar_agent_save",
  "wodeapp.sidebar_agent.save": "wodeapp_sidebar_agent_save",
  page_import_from_file: "wodeapp_page_import_from_file",
  page_import_html: "wodeapp_page_import_from_file",
  product_save: "wodeapp_product_save",
  image_asset_save: "wodeapp_image_asset_save",
  batch_image_prepare: "wodeapp_batch_image_prepare",
  batch_image: "wodeapp_batch_image_prepare",
  video_storyboard_open: "wodeapp_video_storyboard_open",
  video_storyboard_update: "wodeapp_video_storyboard_update",
  "wodeapp.video_storyboard.open": "video_storyboard",
  "wodeapp.video_storyboard.update": "wodeapp_video_storyboard_update",
  video_generate: "wodeapp.video.generate",
  video_task_status: "wodeapp.video.status",
};

export function resolveWodeAppToolDocKey(toolName: string): string | null {
  const normalized = toolName.trim().replace(/^wodeapp-platform_/, "");
  if (TOOL_DOCS[normalized]) return normalized;
  const alias = ALIASES[normalized];
  if (alias && TOOL_DOCS[alias]) return alias;
  return null;
}

export function resolveWodeAppToolDocs(toolName: string): WodeAppToolDocEntry | null {
  const key = resolveWodeAppToolDocKey(toolName);
  return key ? TOOL_DOCS[key] ?? null : null;
}

export function listWodeAppToolDocKeys(): string[] {
  return Object.keys(TOOL_DOCS).sort();
}
