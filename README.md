# yiyulics.github.io

Yiyu Li 的学术主页：<https://yiyulics.github.io>。Jekyll 单页站点，由 GitHub Pages 直接构建，push 到 `main` 即上线。

页面从上到下是：首屏（照片、姓名、一句话定位、研究兴趣的标签、求职状态、互动小图）→ About + News → 按研究方向组织的论文 → 经历时间线（旁边是教育和助教）→ 荣誉与审稿 → 联系方式。

## 改内容

所有文字内容都在 `_data/` 下的 YAML 里，不需要动模板。每个文件开头的注释说明了可用字段。

| 想改什么 | 文件 |
| --- | --- |
| 首屏文案、照片、求职状态、About、研究兴趣、联系方式、社交链接、板块顺序 | `_data/profile.yml` |
| 研究方向（标题、介绍、关键词、进行中的工作） | `_data/research.yml` |
| 论文 | `_data/publications.yml` |
| 新闻 | `_data/news.yml` |
| 实习 / 研究经历 | `_data/experience.yml` |
| 教育经历 | `_data/education.yml` |
| 荣誉奖项 | `_data/honors.yml` |
| 审稿与助教 | `_data/service.yml` |

站点标题、SEO 描述、统计代码在 `_config.yml`。

### 邮箱

仓库和页面源码里都不写邮箱明文，以免被爬虫收集。`_data/profile.yml` 的 `email_code` 存的是编码后的地址，页面在浏览器里把它还原：

- 换邮箱：运行 `python3 scripts/encode_email.py`，输入地址，把打印出来的值填到 `email_code`。`python3 scripts/encode_email.py --check` 可以把当前的值解回来核对。
- 页面上，联系方式一节是一个可以输入的小终端，命令行里预先填好了一条命令：`echo <邮箱的 base64> | base64 -d`。访客点 "Show email"（或按 Enter）运行它，输出邮箱，同时出现 "Email me" 和复制按钮。运行之前，页面里只有 base64，没有邮箱明文，也没有 `mailto:`。没开 JavaScript 时终端不出现。
- 终端里也可以输入别的命令：`help`、`./contact.sh`、`open cv.pdf`、`whoami`、`ls`、`cat`、`echo`、`base64`（可以用 `|` 连接）、`clear`；上下方向键翻历史。其他命令会提示 command not found。命令的定义在 `assets/js/main.js` 的 "Email" 一段。
- 这只是防自动收集的混淆，不是加密：页面必须能还原地址，所以认真去读脚本的人也能还原。
- 公开版 CV（`files/Yiyu_Li_CV.pdf`）里仍有邮箱，那是简历本身的内容。

### 加一篇论文

在 `_data/publications.yml` 里加一项，用 `theme` 指定它属于哪个研究方向（对应 `_data/research.yml` 里的 `id`）：

```yaml
- id: my-paper                        # 锚点是 #pub-my-paper
  theme: worlds                       # worlds | 3d | imaging，或在 research.yml 里新加的方向
  title: "Paper Title"
  authors: [Yiyu Li, Coauthor Name]
  venue: CVPR 2027                    # 在投论文不写 venue，改写 under_review: true
  image: /images/pubs/my-paper.webp   # teaser，显示为 20:9，会居中裁剪
  summary: 一句话介绍。
  links:
    - label: arXiv
      url: https://arxiv.org/abs/xxxx.xxxxx
    - label: Code
      url: https://github.com/yiyulics/xxx
      repo: yiyulics/xxx              # 可选：star 数达到 10 后显示在 Code 按钮上
  abstract: 摘要全文。                 # 可选：显示 Abstract 按钮
  bibtex: |                           # 可选：显示 BibTeX 按钮和复制
    @InProceedings{...}
  openalex: W1234567890               # 可选：显示 Cited by N（OpenAlex 的 work id）
```

- teaser 放在 `images/pubs/`，宽度 1000px 左右即可：`cwebp -q 80 -resize 1120 0 teaser.png -o images/pubs/my-paper.webp`。
- 点 teaser 会在页面内放大显示 `image_full`（没写就用 `image` 本身），按 Esc 或点空白处关闭。
- 还没有 teaser 时可以用 `motif: modes | facets | exposure` 显示一张代码生成的示意图（由 `scripts/make_motifs.py` 生成到 `_includes/motifs/`）。
- 在投论文只标 "Under Review"，不写投稿的会议或期刊，以免违反双盲规定。

### 首屏的互动小图

首屏右侧的 `world.py` 是 code-based world model 的一个小示意：海边的一个瞬间（主角是我）被写成一段程序。同一段程序既能渲染出画面，也能渲染法线、深度、分割，以及它自己的线稿（`wire`：程序眼中的世界，上色之前的几何），还能沿着时间继续往前跑。

- 开场：代码一行行出现，每写出一行，它生成的那部分世界就在线稿里画出来（`Beach` 是天空和沙滩，`Sea` 是海，`Walkers` 是远处的行人，`Person` 是我），然后彩色画面从左往右渲染上去，时间开始走。如果脚本到达较晚，已经显示的代码会保留，静态图直接接入播放。选择减少动态效果时，画面初始化后暂停。
- 鼠标指向画面的某个部分，或指向生成它的那行代码，这部分的线稿会叠在画面上，对应的代码行同时高亮。
- 代码里的数字可以拖动（或聚焦后用方向键）：时刻、风、潮位、浪高、行人数、笑容、帧率。
- 首页默认显示 ASCII。在卡片顶部的 Style 栏可直接选择 ASCII、Pixel 或 Low-poly，代码里的 `Renderer(style=...)` 同步显示当前选择。眼镜、卫衣颜色和渲染视图也可点击切换。
- 人物身后是一个真正的 3D 场景，三种画风共用：拖动画面可以转动镜头，左右看海湾，上下看天空（键盘用方向键）。点画面里的人会挥手；下方的时间条可以播放、暂停、把时刻拖到傍晚或夜里。

涉及的文件：

- `_includes/world.html`：代码片段和默认参数（改那里的数字就是改默认画面）。生成某部分世界的代码行带 `data-part`。
- `assets/js/scenes/` 中的三个渲染器按需加载，每个都提供 `style`、`W`、`H`、`draw(ctx, state)`、`hit(x, y)` 和 `pick(x, y, state)`。它们各自用自己的画法画人物；像素版与 ASCII 版共用 `assets/js/beach-portrait.js` 中的人物和关节。
- `assets/js/beach-env.js`：人物身后的 3D 世界，用 WebGL 2 渲染，没有依赖任何库。地形、海面、带灯塔的小岛、帆船、行人都是代码生成的网格；卡通着色加描边，海面和湿沙有倒影，云、日月星辰和配色随时刻变化，最后做泛光和调色。Low-poly 直接把这幅画面铺在人物身后；Pixel 和 ASCII 把它按自己的网格读回来，再重画成像素（按亮度分级加抖动）或字符（轮廓、浪尖、沙粒、星星）。法线、深度、分割和线稿这几个视图是同一份几何体换一种画法。浏览器不支持 WebGL 2 时这个文件什么也不注册，三个渲染器会改用各自原来的平面背景，画面也就不能转动。
- `assets/js/world.js`：舞台：读参数、计时、控件、开场动画和指向高亮。
- `images/world.webp`：默认画面的静态图，没有 JavaScript 时显示。如果更换 `_data/profile.yml` 的 `hero.style` 或修改相应画面，请重新导出：在本地预览里对画面右键"图片另存为"，再 `cwebp -q 85 world.png -o images/world.webp`。

不想要这个小图，把 `_data/profile.yml` 里的 `hero.demo` 改成 `false`。

### 更新 CV

主页上的 CV 是从简历源文件自动生成的公开版：去掉手机号，并把 "Submitted to XXX" 换成 "Under Review"。

```bash
./scripts/build_public_cv.sh                  # 默认读取 ../resume/main.tex
./scripts/build_public_cv.sh /path/to/main.tex
```

输出到 `files/Yiyu_Li_CV.pdf`。如果生成的 PDF 里仍然检测到手机号或 "Submitted to"，脚本会报错并拒绝覆盖。

### 引用数和 star 数

- 引用数：页面加载时请求 [OpenAlex](https://openalex.org) 的公开 API，一次请求查完页面上所有写了 `openalex` 的论文，结果在浏览器里保存一天。Research 标题旁的总数是这些论文引用数之和。论文的 work id 这样查：打开 `https://api.openalex.org/works/https://doi.org/10.48550/arXiv.<arXiv 编号>`，取返回结果里 `id` 末尾的 `W…`。数字来自 OpenAlex，和 Google Scholar 上的会略有出入。
- star 数：页面加载时直接请求 GitHub 的公开 API。

两者都是可选的，取不到时页面只是不显示数字。

### 机构图标和网站图标

- Experience 时间线和 Education 里机构名前面的小图标：在 `_data/experience.yml` 或 `_data/education.yml` 的条目里写 `logo: /images/orgs/xxx.png`（方形图，96px 左右即可，白底）。不写就显示原来的圆点。现有图标取自各机构官网的站点图标或页头 logo。
- 网站图标（浏览器标签页上的小图）是像素风渲染器画的头像，文件是 `images/` 下的 `favicon*.png`、`favicon.ico`、`apple-touch-icon.png`、`android-chrome-*.png`，另外根目录有一份同样的 `favicon.ico`（很多爬虫和浏览器默认去根目录找）。换图标时两处的 `favicon.ico` 都要换。

### 其他细节

- 首屏以下的各块内容在滚动到时会淡入；系统开了"减少动态效果"时不做任何动画。
- `images/` 里有几张旧 teaser 的原图（`crop.py`、`merge.py`、`resize.py` 的输入），页面不用它们，已在 `_config.yml` 的 `exclude` 里排除，不会发布到网站上。以后如果要用其中某张，从 `exclude` 里删掉对应那行。

## 本地预览

需要 Ruby 3 以上（macOS 自带的 2.6 不行）。例如用 conda：

```bash
conda create -n jekyll -c conda-forge ruby=3.3 c-compiler cxx-compiler make
conda activate jekyll
bundle install
./run_server.sh          # http://localhost:4000 ，保存后自动刷新
```

改 `_config.yml` 之后需要重启预览服务。

## 结构

```
_config.yml              站点设置
_data/                   全部内容
_layouts/default.html    页面骨架
_includes/
  topbar.html            顶部导航
  hero.html, world.html  首屏和互动小图
  sections/              About、Research、Experience、Honors、Contact
  pub.html               单篇论文
  icon.html, motifs/     图标和论文示意图
assets/css/main.css      样式（纯 CSS，含深色模式）
assets/js/main.js        主题切换、导航高亮、摘要/BibTeX、复制、引用数、star 数
assets/js/scenes/        首屏的三种画风
assets/js/beach-env.js   三种画风共用的 3D 场景（WebGL 2）
assets/js/beach-portrait.js  像素版和 ASCII 版共用的人物
assets/js/world.js       首屏互动小图：舞台、控件和开场动画
assets/fonts/            自托管字体（Newsreader、Geist、Geist Mono，OFL 许可）
images/                  头像、论文 teaser、favicon
files/                   公开版 CV
scripts/                 生成公开版 CV 和论文示意图的脚本
```

本站最初基于 [AcadHomepage](https://github.com/RayeRen/acad-homepage.github.io) 模板搭建（MIT 许可，见 `LICENSE`）。
