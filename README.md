# yiyulics.github.io

Yiyu Li 的学术主页：<https://yiyulics.github.io>。Jekyll 单页站点，由 GitHub Pages 直接构建，push 到 `main` 即上线。

## 改内容

所有文字内容都在 `_data/` 下的 YAML 里，不需要动模板。

| 想改什么 | 文件 |
| --- | --- |
| 姓名、简介、求职状态、研究兴趣、社交链接、板块顺序 | `_data/profile.yml` |
| 新闻 | `_data/news.yml` |
| 论文 | `_data/publications.yml` |
| 实习 / 研究经历 | `_data/experience.yml` |
| 教育经历 | `_data/education.yml` |
| 荣誉奖项 | `_data/honors.yml` |
| 审稿与助教 | `_data/service.yml` |

每个文件开头的注释说明了可用字段。站点标题、SEO 描述、统计代码在 `_config.yml`。

### 加一篇论文

在 `_data/publications.yml` 里加一项（列表顺序就是页面顺序）：

```yaml
- title: "Paper Title"
  authors: [Yiyu Li, Coauthor Name]
  venue: CVPR 2027                    # 在投论文不写 venue，改写 under_review: true
  image: /images/pubs/my-paper.webp   # teaser，显示为 20:9，会居中裁剪
  summary: 一句话介绍。
  links:
    - label: arXiv
      url: https://arxiv.org/abs/xxxx.xxxxx
    - label: Code
      url: https://github.com/yiyulics/xxx
  scholar_id: "SXOMocYAAAAJ:xxxxxxxxxxxx"   # 可选，用来显示 Cited by N
```

- teaser 放在 `images/pubs/`，宽度 1000px 左右即可：`cwebp -q 80 -resize 1120 0 teaser.png -o images/pubs/my-paper.webp`。
- 还没有 teaser 时可以用 `motif: modes | facets | exposure` 显示一张代码生成的示意图（由 `scripts/make_motifs.py` 生成到 `_includes/motifs/`）。
- 在投论文只标 "Under Review"，不写投稿的会议或期刊，以免违反双盲规定。

### 更新 CV

主页上的 CV 是从简历源文件自动生成的公开版：去掉手机号，并把 "Submitted to XXX" 换成 "Under Review"。

```bash
./scripts/build_public_cv.sh                  # 默认读取 ../resume/main.tex
./scripts/build_public_cv.sh /path/to/main.tex
```

输出到 `files/Yiyu_Li_CV.pdf`。如果生成的 PDF 里仍然检测到手机号或 "Submitted to"，脚本会报错并拒绝覆盖。

### 引用数

`.github/workflows/google_scholar_crawler.yaml` 每天抓取 Google Scholar，把结果写到 `google-scholar-stats` 分支，页面加载时读取并显示总引用数和每篇论文的 "Cited by N"。抓取失败时页面只是不显示数字。可以在 GitHub 的 Actions 页面手动运行这个 workflow。

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
_includes/               侧栏、图标、各板块模板（sections/）、论文示意图（motifs/）
assets/css/main.css      样式（纯 CSS，含深色模式）
assets/js/main.js        主题切换、导航高亮、引用数
assets/fonts/            自托管字体（Newsreader、Geist、Geist Mono，OFL 许可）
images/                  头像、论文 teaser、favicon
files/                   公开版 CV
scripts/                 生成公开版 CV 和论文示意图的脚本
google_scholar_crawler/  引用数抓取脚本
```

引用数抓取部分来自 [AcadHomepage](https://github.com/RayeRen/acad-homepage.github.io) 模板（MIT 许可，见 `LICENSE`）。
