# Issue 跟踪器：GitHub

本仓库的 issue 和 spec 作为 GitHub issue 存在（`mrh30000/browsercli`）。所有操作都用 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读取 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配以合适的 `--label` 和 `--state` 过滤。
- **把某个 issue 设成父 issue 的子 issue**：`gh issue create --parent <parent> ...`，或事后 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。更老的 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（数据库 id，见下方 **Blocking**）。不支持子 issue 时，在子 issue 正文顶部写 `Part of #<parent>`。
- **在 issue 上评论**：`gh issue comment <number> --body "..."`
- **打上 / 移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

从 `git remote -v` 推断仓库；在克隆里运行时 `gh` 会自动这么做。

## 把 Pull Request 当作分诊入口

**PR 作为请求入口：否。** _（如果本仓库把外部 PR 当作功能请求处理，就设为 `yes`；`/triage` 会读这个标志。）_

当设为 `yes` 时，PR 与 issue 走同样的标签和状态，使用 `gh pr` 的对应命令：

- **读取 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待分诊的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 和 PR 共用一个编号空间，所以裸的 `#42` 可能是两者之一：先用 `gh pr view 42` 解析，不行再退回 `gh issue view 42`。

## 当一个 skill 说"发布到 issue 跟踪器"

创建一个 GitHub issue。

## 当一个 skill 说"取回相关的 ticket"

按上面 **读取 issue** 的方式读它。

## Wayfinding 操作

由 `/wayfinder` 使用。**地图**是单个 issue，其**子** issue 是 ticket。

- **地图**：一个打上 `wayfinder:map` 标签的 issue，持有 Notes / Decisions-so-far / Fog 正文。`gh issue create --label wayfinder:map`。
- **子 ticket**：一个作为 GitHub 子 issue 链接到地图的 issue（见 **把某个 issue 设成父 issue 的子 issue**）。在未启用子 issue 的地方，把子 issue 加到地图正文里的任务清单，并在子 issue 正文顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。一旦被认领，ticket 被指派给驱动它的开发者。
- **阻塞**：GitHub 的**原生 issue 依赖**，这是规范且 UI 可见的表达。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加一条边，其中 `<blocker-db-id>` 是阻塞者的数字**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 也不是 `node_id`）。GitHub 会报告 `issue_dependencies_summary.blocked_by`（只含开放的阻塞者，即实时的闸门）。在依赖不可用的地方，退回在子 issue 正文顶部写一行 `Blocked by: #<n>, #<n>`。当所有阻塞者都已关闭时，ticket 就是未阻塞的。
- **前沿查询**：列出地图的开放子 issue（`gh issue list --state open`，限定到地图的子 issue / 任务清单），丢掉任何有开放阻塞者（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里有一个开放 issue）或有受派人的；按地图顺序第一个胜出。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写入。
- **解决**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，然后往地图的 Decisions-so-far 追加一个上下文指针（概述 + 链接）。
