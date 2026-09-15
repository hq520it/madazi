#!/bin/bash
# 安全加固端到端验证脚本
# 部署完成后在服务器上执行

BASE="https://<YOUR-DOMAIN>/api"

echo "=== 1. 健康检查 ==="
curl -s "$BASE/health" | python3 -m json.tool
echo

echo "=== 2. 未登录访问项目（应 401）==="
curl -s -o /dev/null -w "%{http_code}" "$BASE/projects"
echo
echo

echo "=== 3. 管理员登录 ==="
ADMIN_LOGIN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"madazi_admin_2026"}')
echo "$ADMIN_LOGIN" | python3 -m json.tool
TOKEN=$(echo "$ADMIN_LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token: ${TOKEN:0:30}..."
echo

echo "=== 4. 获取当前用户 ==="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/auth/me" | python3 -m json.tool
echo

echo "=== 5. 访问项目列表（带 token，应 200）==="
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE/projects"
echo
echo

echo "=== 6. 生成邀请码 ==="
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$BASE/admin/invites" | python3 -m json.tool
echo

echo "=== 7. 邀请码列表 ==="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/admin/invites" | python3 -m json.tool
echo

echo "=== 8. 注册新用户 ==="
# 取第一个未使用的邀请码
CODE=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/admin/invites" | python3 -c "import sys,json; codes=json.load(sys.stdin); print(next((c['code'] for c in codes if not c['used_at']), ''))")
echo "Using invite code: $CODE"
if [ -n "$CODE" ]; then
  curl -s -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"code\":\"$CODE\",\"username\":\"testuser\",\"password\":\"test123456\"}" | python3 -m json.tool
fi
echo

echo "=== 9. 普通用户登录 ==="
USER_LOGIN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}')
echo "$USER_LOGIN" | python3 -m json.tool
USER_TOKEN=$(echo "$USER_LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo

echo "=== 10. 普通用户访问管理员 API（应 403）==="
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $USER_TOKEN" "$BASE/admin/users"
echo
echo

echo "=== 11. 用户列表（管理员）==="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/admin/users" | python3 -m json.tool
echo

echo "=== 12. LLM 配置脱敏检查 ==="
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/llm/configs" | python3 -m json.tool
echo

echo "=== 验证完成 ==="
