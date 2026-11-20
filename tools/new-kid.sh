#!/usr/bin/env bash
# 给一个孩子开一份游戏副本：在组织 SmushMafia 下建公开仓库 <id> + 写权限 deploy key + 开 Pages，
# 打包成 dist/smushO-<id>.zip 发给孩子，并把他加进 hub/kids.json。
# 用法：tools/new-kid.sh <id，小写字母数字和-> [显示名]
# 例：  tools/new-kid.sh xiaoming 小明
set -euo pipefail

ID=${1:?用法：tools/new-kid.sh <id> [显示名]}
NAME=${2:-$ID}
[[ $ID =~ ^[a-z0-9-]+$ ]] || { echo "id 只能用小写字母、数字、-（GitHub 仓库名不支持中文）"; exit 1; }

ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
OWNER=${SMUSHO_ORG:-SmushMafia}   # 孩子仓库都放在这个组织下
REPO=$ID
PKG=smushO-$ID     # 新手包文件夹 / zip 名
DIST=$ROOT/dist
WORK=$DIST/$PKG
[[ -e $WORK || -e $DIST/$PKG.zip ]] && { echo "$WORK 已存在，先删掉"; exit 1; }
mkdir -p "$DIST"

# 1. 从骨架当前 main 复制（保留历史，之后能直接 cherry-pick 回来）
git clone -q --no-local "$ROOT" "$WORK"
cd "$WORK"
git rm -rq tools hub
cat "$ROOT/tools/kid-rules.md" >> CLAUDE.md
{ echo "项目说明见 CLAUDE.md。"; cat "$ROOT/tools/kid-rules.md"; } > AGENTS.md
git config user.name "$NAME"
git config user.email "$ID@smusho.invalid"
git add -A && git commit -qm "start: $NAME 的版本"

# 2. 建仓库并推上去（用你自己的 gh 登录）
git remote remove origin
gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --push >/dev/null

# 3. 孩子用的 deploy key：只对这一个仓库有写权限，放在 .git 里不会被提交
ssh-keygen -q -t ed25519 -N "" -C "$OWNER/$REPO" -f .git/smushO-key
gh repo deploy-key add .git/smushO-key.pub -R "$OWNER/$REPO" --allow-write -t "kid-$ID" >/dev/null
git remote set-url origin "git@github.com:$OWNER/$REPO.git"
git config core.sshCommand "ssh -i .git/smushO-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

# 4. Pages：直接发布 main 根目录，无需构建
gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null

# 5. 打包
cd "$DIST" && zip -qr "$PKG.zip" "$PKG" && rm -rf "$WORK"

# 6. 加进切换站 + 骨架仓库里加个 remote，方便 cherry-pick
cd "$ROOT"
python3 - "$ID" "$NAME" "$OWNER/$REPO" <<'PY'
import json, sys
p = 'hub/kids.json'; kids = json.load(open(p, encoding='utf-8'))
kids = [k for k in kids if k['id'] != sys.argv[1]] + [{'id': sys.argv[1], 'name': sys.argv[2], 'repo': sys.argv[3]}]
json.dump(kids, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
git remote add "kid-$ID" "https://github.com/$OWNER/$REPO.git" 2>/dev/null || true
git add hub/kids.json && git commit -qm "hub: add $NAME" && git push -q

echo "完成：把 dist/$PKG.zip 发给 ${NAME}（里面有写权限密钥，别外传）"
echo "他的版本：https://$(tr A-Z a-z <<<"$OWNER").github.io/$REPO/  （首次部署约 1 分钟）"
