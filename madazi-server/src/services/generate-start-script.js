import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { chatStream } from './llm.js';
import { db } from '../db/init.js';

/**
 * 收集项目信息：文件树 + 关键配置文件内容
 */
export function collectProjectInfo(projectDir) {
  const info = {
    tree: [],
    files: {},
    detection: {},
  };

  // 收集文件树（2 层深度，排除 node_modules/.git/dist）
  function walk(dir, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (['node_modules', '.git', 'dist', 'target', '.next', '__pycache__', '.venv'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(projectDir, full);
      info.tree.push(rel + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) {
        walk(full, depth + 1, maxDepth);
      }
    }
  }
  walk(projectDir);

  // 读取关键配置文件（同时检查根目录和 frontend/backend 子目录）
  const keyFiles = [
    // 前端配置（根目录 + frontend/）
    'package.json',
    'frontend/package.json',
    'vite.config.ts',
    'vite.config.js',
    'frontend/vite.config.ts',
    'frontend/vite.config.js',
    'tsconfig.json',
    'frontend/tsconfig.json',
    'next.config.js',
    'next.config.mjs',
    'nuxt.config.ts',
    'nuxt.config.js',
    'angular.json',
    // 后端配置（根目录 + backend/）
    'backend/package.json',
    'pom.xml',
    'backend/pom.xml',
    'build.gradle',
    'backend/build.gradle',
    'build.gradle.kts',
    'backend/build.gradle.kts',
    'application.properties',
    'application.yml',
    'backend/application.properties',
    'backend/application.yml',
    'backend/src/main/resources/application.properties',
    'backend/src/main/resources/application.yml',
    'requirements.txt',
    'pyproject.toml',
    'backend/requirements.txt',
    'go.mod',
    'backend/go.mod',
    'Cargo.toml',
    'backend/Cargo.toml',
    'Gemfile',
    'composer.json',
    // .NET
    '*.csproj',
    '*.sln',
    '*.fsproj',
    // 部署
    'docker-compose.yml',
    'docker-compose.yaml',
    'Dockerfile',
  ];

  for (const kf of keyFiles) {
    // 支持通配符（如 *.csproj）
    if (kf.includes('*')) {
      const dir = path.dirname(path.join(projectDir, kf));
      const pattern = path.basename(kf);
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          const pat = pattern.replace('*', '.*');
          if (new RegExp('^' + pat + '$').test(e.name)) {
            const full = path.join(dir, e.name);
            const rel = path.relative(projectDir, full);
            const content = fs.readFileSync(full, 'utf8');
            info.files[rel] = content.length > 2000
              ? content.slice(0, 2000) + '\n... (truncated)'
              : content;
          }
        }
      } catch { /* dir not found */ }
      continue;
    }
    const full = path.join(projectDir, kf);
    if (fs.existsSync(full)) {
      const content = fs.readFileSync(full, 'utf8');
      info.files[kf] = content.length > 2000
        ? content.slice(0, 2000) + '\n... (truncated)'
        : content;
    }
  }

  // 检测技术栈
  const detection = {};
  const allFiles = Object.keys(info.files);
  const rootPkg = info.files['package.json'] || '';
  const fePkg = info.files['frontend/package.json'] || '';
  const bePkg = info.files['backend/package.json'] || '';
  // 检测 .NET 项目文件
  const csprojFile = allFiles.find(f => f.endsWith('.csproj'));
  const slnFile = allFiles.find(f => f.endsWith('.sln'));

  // 前端检测（先查 frontend/package.json，再查根 package.json）
  const frontendPkg = fePkg || rootPkg;
  if (frontendPkg) {
    if (frontendPkg.includes('"next"')) detection.frontend = 'Next.js';
    else if (frontendPkg.includes('"nuxt"') || frontendPkg.includes('nuxt3')) detection.frontend = 'Nuxt';
    else if (frontendPkg.includes('"@angular/core"')) detection.frontend = 'Angular';
    else if (frontendPkg.includes('"react"')) detection.frontend = 'React';
    else if (frontendPkg.includes('"@dcloudio/uni-app"')) detection.frontend = 'uni-app';
    else if (frontendPkg.includes('"vue"')) detection.frontend = 'Vue';
    else if (frontendPkg.includes('"svelte"') || frontendPkg.includes('"@sveltejs/kit"')) detection.frontend = 'Svelte/SvelteKit';
    else if (frontendPkg.includes('"@nestjs/core"')) detection.backend = 'NestJS';
    else detection.frontend = 'Node.js (未知框架)';
  }

  // 后端检测
  if (info.files['pom.xml'] || info.files['backend/pom.xml']) detection.backend = 'Spring Boot (Java/Maven)';
  else if (info.files['build.gradle'] || info.files['backend/build.gradle'] || info.files['build.gradle.kts'] || info.files['backend/build.gradle.kts']) detection.backend = 'Java/Gradle';
  else if (bePkg && bePkg.includes('"@nestjs/core"')) detection.backend = 'NestJS (Node.js)';
  else if (bePkg) detection.backend = 'Node.js';
  else if (info.files['requirements.txt'] || info.files['pyproject.toml'] || info.files['backend/requirements.txt']) {
    const pyFile = info.files['requirements.txt'] || info.files['pyproject.toml'] || info.files['backend/requirements.txt'] || '';
    if (pyFile.includes('django')) detection.backend = 'Python (Django)';
    else if (pyFile.includes('fastapi')) detection.backend = 'Python (FastAPI)';
    else if (pyFile.includes('flask')) detection.backend = 'Python (Flask)';
    else detection.backend = 'Python';
  }
  else if (info.files['go.mod'] || info.files['backend/go.mod']) {
    const goFile = info.files['go.mod'] || info.files['backend/go.mod'] || '';
    if (goFile.includes('gin-gonic/gin')) detection.backend = 'Go (Gin)';
    else if (goFile.includes('gofiber/fiber')) detection.backend = 'Go (Fiber)';
    else detection.backend = 'Go';
  }
  else if (info.files['Cargo.toml'] || info.files['backend/Cargo.toml']) detection.backend = 'Rust';
  else if (info.files['Gemfile']) detection.backend = 'Ruby (Rails/Sinatra)';
  else if (info.files['composer.json']) detection.backend = 'PHP (Laravel/Composer)';
  else if (csprojFile || slnFile) {
    detection.backend = '.NET (C#/F#)';
    detection.dotnetProject = csprojFile || slnFile;
  }

  // 数据库检测：扫描 application.yml/properties 和其他配置
  const configText = [
    info.files['application.yml'],
    info.files['application.properties'],
    info.files['backend/application.yml'],
    info.files['backend/application.properties'],
    info.files['backend/src/main/resources/application.yml'],
    info.files['backend/src/main/resources/application.properties'],
    info.files['docker-compose.yml'],
    info.files['docker-compose.yaml'],
  ].filter(Boolean).join('\n');

  if (configText) {
    const dbUrlMatch = configText.match(/datasource[^}]*url[^}]*:?\s*[^}]*\n[^\n]* jdbc:([^:]+)/) 
      || configText.match(/jdbc:(\w+):/)
      || configText.match(/DATABASE_URL.*?:\/\/(\w+):/);
    if (dbUrlMatch) {
      const dbType = dbUrlMatch[1].toLowerCase();
      if (dbType === 'postgresql') detection.database = 'PostgreSQL';
      else if (dbType === 'mysql') detection.database = 'MySQL';
      else if (dbType === 'mariadb') detection.database = 'MariaDB';
      else if (dbType === 'sqlite') detection.database = 'SQLite';
      else if (dbType === 'mongodb' || dbType === 'mongo') detection.database = 'MongoDB';
      else if (dbType === 'h2') detection.database = 'H2 (内存数据库)';
      else if (dbType === 'sqlserver') detection.database = 'SQL Server';
      else detection.database = dbType;
    }
    // 检查 docker-compose 中的数据库服务
    if (!detection.database) {
      if (configText.includes('mysql')) detection.database = 'MySQL';
      else if (configText.includes('postgres')) detection.database = 'PostgreSQL';
      else if (configText.includes('mongo')) detection.database = 'MongoDB';
      else if (configText.includes('redis')) detection.database = 'Redis';
    }
  }

  info.detection = detection;
  return info;
}

/**
 * 安全检查：拒绝危险模式
 */
function safetyCheck(scriptContent) {
  const dangerousPatterns = [
    { pattern: /rm\s+-rf\s+\/(?!\S)/, msg: 'rm -rf / (危险操作)' },
    { pattern: /curl\s+[^|]+\|\s*(ba)?sh/, msg: 'curl pipe to shell (远程执行)' },
    { pattern: /wget\s+[^|]+\|\s*(ba)?sh/, msg: 'wget pipe to shell (远程执行)' },
    { pattern: /:\(\)\s*\{/, msg: 'fork bomb' },
    { pattern: /mkfs/, msg: 'mkfs (格式化磁盘)' },
    { pattern: /dd\s+.*of=\/dev\//, msg: 'dd 写入设备文件' },
  ];

  for (const { pattern, msg } of dangerousPatterns) {
    if (pattern.test(scriptContent)) {
      return { safe: false, reason: msg };
    }
  }
  return { safe: true };
}

const SYSTEM_PROMPT = `你是 Madazi 平台的 DevOps 助手，负责为项目生成预览容器的启动脚本 (backend-start.sh)。

## 预览环境约束（必须遵守，不可省略）

1. 容器内项目路径：/data/$PROJECT_DIR/（环境变量 PROJECT_DIR 已注入）
2. 环境变量已注入：PROJECT_DIR, PROJECT_ID, HAS_BACKEND, HAS_FRONTEND
3. 脚本开头必须 set -e

4. ★ HMR 必须关闭：在 vite.config 中确保 server: { hmr: false }
   原因：预览通过反向代理访问，WebSocket 穿不过代理，会导致疯狂重连

5. ★ 前端 base 必须用环境变量：
   const BASE = process.env.VITE_BASE || '/'
   base: BASE + '/'
   （VITE_BASE 已由平台注入，格式：/ → 短 URL 预览，pv-<id8>.<域> 直接打开应用）

6. ★ API 请求路径必须用相对路径：
   axios baseURL: 'api'（不是 '/api'，不是 'http://localhost:8080/api'）
   如果代码里有 localhost 硬编码，需要 sed 替换为相对路径

7. 如果有后端，VITE_BE_URL 环境变量已注入指向后端地址
   Node.js 后端 -> http://localhost:3001
   Spring Boot 后端 -> http://localhost:8080

8. ★ 数据库处理（先看「技术栈检测结果」的 database 字段；未检测到则从配置文件 datasource.url 判断实际数据库类型）：
   预览容器已预装 PostgreSQL 16（localhost:5432，数据库 appdb，用户 postgres 无密码），pgcrypto 扩展已启用
   - 项目用 PostgreSQL -> 直接用 appdb；若项目指定了其他库名，先创建：
     su postgres -c "psql -c \"CREATE DATABASE <库名>;\""
   - 项目用 MariaDB/MySQL -> 在脚本里安装 MariaDB 并创建数据库：
     sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories
     apk add --no-cache mariadb mariadb-client
     mysql_install_db --user=mysql --datadir=/var/lib/mysql
     mysqld --user=mysql --datadir=/var/lib/mysql &
     等待就绪用 mysqladmin ping 轮询（不要 sleep 固定秒数）
     mysql -u root -e "CREATE DATABASE IF NOT EXISTS <项目库名>;"
   - 项目用 SQLite -> 无需额外安装，直接用文件
   - 项目用 MongoDB -> 在脚本里安装 MongoDB：
     apk add --no-cache mongodb
     mongod --dbpath /tmp/mongodb --fork --logpath /tmp/mongo.log
   - 项目用 H2 内存数据库 -> 无需额外操作
   - 项目用 SQL Server -> 无法在 Alpine 安装，改为 PostgreSQL 并提示用户
   - ★ 必须执行数据库初始化 SQL：若项目有 sql/ 目录或根目录存在 *.sql 脚本（如 Madazi 的 madazi_*.sql 系统表脚本、业务建表脚本），数据库就绪后依次执行（只执行一次，表已存在则跳过）：
     PostgreSQL: cd /data/$PROJECT_DIR && su postgres -c "psql -d <库名> -f sql/<文件>.sql"
     MariaDB/MySQL: cd /data/$PROJECT_DIR && mysql -u root <库名> < sql/<文件>.sql
   - 注意：项目源码里的数据库连接串若与预览环境不符，必须用 sed 替换为预览环境实际地址/库名/账号

9. 依赖安装用国内镜像加速：
   npm install --registry=https://registry.npmmirror.com

10. 前端必须监听 0.0.0.0:5173（Vite dev server）
    用 exec npx vite --host 0.0.0.0 --port 5173 作为最后一步（替换 PID 1）

11. 后端启动用后台进程 (&)，然后轮询探测就绪，不要 sleep 固定秒数

## 容器运行时环境

预览镜像基于 Alpine Linux，已预装：
- Node.js 18 + npm 10 + yarn 1.22
- JDK 17 + Maven 3.9
- PostgreSQL 16（localhost:5432，数据库 appdb，用户 postgres 无密码）
- bash, curl, apk（Alpine 包管理器）

未预装的运行时（如需用，必须在脚本里安装）：
- Python: sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && apk add --no-cache python3 py3-pip
- Go: sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && apk add --no-cache go
- .NET: 预览环境无法安装 .NET SDK（体积过大），如项目是 .NET，在脚本中 echo 提示并 exit 1
- pnpm: npm install -g pnpm
- Ruby: apk add --no-cache ruby ruby-bundler
- PHP: apk add --no-cache php php-mysqli php-pdo_mysql php-xml php-mbstring composer
- 其他包: 先换国内源再 apk add（★ 必须换源，否则下载极慢）

⚠️ apk add 每次容器启动都会重新执行（容器是临时的），只装真正需要的包

## ★ 日志可见性铁律
所有安装/编译命令的输出必须保留在 stdout/stderr，**禁止重定向到 /dev/null**，**禁止用 --silent/--quiet**。
用户需要在日志面板看到完整的依赖安装过程。每步操作前加 echo 标记：
  echo "📦 正在安装系统依赖..."
  apk add --no-cache ...
  echo "📦 正在安装 npm 依赖..."
  npm install --registry=https://registry.npmmirror.com
  echo "🔨 正在编译后端..."
  mvn compile ...

## 常见技术栈启动方式

- React/Vue/Svelte/Nuxt + Vite: npm install --registry=https://registry.npmmirror.com -> exec npx vite --host 0.0.0.0 --port 5173
- Next.js: npm install --registry=https://registry.npmmirror.com -> exec npx next dev -H 0.0.0.0 -p 5173
- Angular: npm install --registry=https://registry.npmmirror.com -> exec npx ng serve --host 0.0.0.0 --port 5173
- Spring Boot: cd backend -> mvn spring-boot:run -DskipTests &
- Node.js 后端: cd backend -> npm install --registry=https://registry.npmmirror.com -> npm start &
- NestJS: cd backend -> npm install --registry=https://registry.npmmirror.com -> npm run start:dev &
- Python (Django): (先 apk add python3 py3-pip) -> pip install -r requirements.txt -> python manage.py migrate && python manage.py runserver 0.0.0.0:3001 &
- Python (FastAPI): (先 apk add python3 py3-pip) -> pip install -r requirements.txt -> uvicorn main:app --host 0.0.0.0 --port 3001 &
- Python (Flask): (先 apk add python3 py3-pip) -> pip install -r requirements.txt -> flask run --host 0.0.0.0 --port 3001 &
- Go: (先 apk add go) -> cd backend ->
  ★ 必须设置编译缓存到非 /tmp 路径（/tmp 只有 100MB tmpfs，编译会空间不足）：
    export GOCACHE=/root/.cache/go-build
    export GOTMPDIR=/root/.cache/gotmp
    mkdir -p "$GOCACHE" "$GOTMPDIR"
    export GOPROXY=https://goproxy.cn,direct
    export GOFLAGS=-mod=mod
  ★ 必须用 go mod tidy 补全 go.sum（go mod download 不会添加缺失条目）：
    go mod tidy
  ★ 先 build 再 run，不要直接 go run（go run 每次都要重新编译）：
    go build -ldflags="-s -w" -o server . && ./server &
- Ruby (Rails): (先 apk add ruby ruby-bundler) -> bundle install -> rails server -b 0.0.0.0 -p 3001 &
- PHP (Laravel): (先 apk add php composer php-*) -> composer install -> php artisan serve --host 0.0.0.0 --port 3001 &
- .NET: 无法在预览容器运行，脚本中 echo "⚠️ .NET 项目暂不支持预览" && exit 1

## Spring Boot 3 特别注意
如果后端是 Spring Boot 3，需要修复 javax -> jakarta：
  find backend/src/main/java -name "*.java" -exec sed -i \\
    -e 's/javax\\.persistence/jakarta.persistence/g' \\
    -e 's/javax\\.servlet/jakarta.servlet/g' \\
    -e 's/javax\\.validation/jakarta.validation/g' \\
    {} +

## ★ sed 替换铁律
用 sed 替换配置文件中的数据库连接串、Redis 地址等内容时，替换值中如果包含 & 字号（如 MySQL DSN 中的 charset=utf8mb4&parseTime=true&loc=Local），**必须转义为 \\&**，否则 sed 会把 & 解释为「整个匹配文本」，导致配置文件内容被破坏。
错误示例：sed 's|"dsn":.*|"dsn": "...charset=utf8mb4&parseTime=true"|'  <- & 会被展开为原始匹配内容
正确示例：sed 's|"dsn":.*|"dsn": "...charset=utf8mb4\\&parseTime=true"|'  <- \\& 是字面 &

## ★ 超时兜底铁律
预览容器资源有限（1024MB 内存），后端编译/启动可能超时。必须加 timeout 防止卡死前端启动：
- 后端编译：timeout 120 <编译命令> || echo "⚠️ 后端编译超时，跳过"
- 后端启动等待：用 for 循环最多等 15 秒，超时则 echo 警告但不阻塞
- 数据库初始化：timeout 30 <命令> || echo "⚠️ 数据库初始化超时"
- ★ MariaDB/MySQL 启动后不要 sleep 2 就连，要用 mysqladmin ping 轮询等待（首次启动需 3-5 秒）
- ★ 最终的 exec npx vite（前端）必须能执行到，不能被前面的失败阻塞
- 用 set +e 在后端编译/启动段，用 set -e 在前端启动段

## 输出格式
直接输出一个完整的 bash 脚本，用 \`\`\`bash 包裹。
不要解释，不要多余文字，只输出脚本。
脚本必须可以直接用 bash 执行。`;

/**
 * 从 AI 回复中提取 bash 代码块
 */
function extractBashBlock(text) {
  // 匹配 ```bash ... ``` 或 ```sh ... ```
  const match = text.match(/```(?:bash|sh)?\s*\n([\s\S]*?)```/);
  if (match) return match[1].trim();
  // 如果没有代码块包裹，尝试直接当脚本用（以 #!/bin/bash 开头）
  if (text.trim().startsWith('#!')) {
    return text.trim();
  }
  return null;
}

/**
 * 为项目生成 AI 驱动的启动脚本
 * @param {string} projectId - 项目 ID
 * @param {function} [onChunk] - 流式回调（可选，用于前端展示生成过程）
 * @returns {Promise<{success: boolean, scriptPath?: string, error?: string}>}
 */
export async function generateStartScript(projectId, onChunk) {
  // 获取项目路径
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  if (!rows.length || !rows[0].source_path) {
    return { success: false, error: '项目路径未找到' };
  }
  const projectDir = rows[0].source_path;

  // ★ 若模板已自带 backend-start.sh（如 Madazi 模板自带 MariaDB+Redis 启动脚本），
  //   直接保留模板脚本，不覆盖（模板脚本比 AI 生成更精确）
  const existingScript = path.join(projectDir, 'backend-start.sh');
  if (fs.existsSync(existingScript)) {
    onChunk?.('\n\n✅ 模板已自带 backend-start.sh，跳过 AI 生成\n');
    return { success: true, scriptPath: existingScript };
  }

  // 1. 收集项目信息
  const info = collectProjectInfo(projectDir);

  if (info.tree.length === 0) {
    return { success: false, error: '项目目录为空' };
  }

  // 2. 构建 user prompt
  const detectionText = Object.entries(info.detection)
    .map(([k, v]) => `- ${k}：${v}`)
    .join('\n');

  const filesText = Object.entries(info.files)
    .map(([k, v]) => `### ${k}\n\`\`\`\n${v}\n\`\`\``)
    .join('\n\n');

  const userPrompt = `请为以下项目生成预览容器的启动脚本 backend-start.sh。

## 技术栈检测结果
${detectionText || '(未检测到已知技术栈，请根据文件内容判断)'}

## 项目文件树
\`\`\`
${info.tree.join('\n')}
\`\`\`

## 关键配置文件内容
${filesText || '(无配置文件)'}

请根据项目实际情况，生成一个完整的 backend-start.sh 脚本。`;

  onChunk?.('正在分析项目结构并生成启动脚本...\n\n');

  // 3. 调用 AI 生成
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const response = await chatStream(messages, onChunk, {
    temperature: 0.2,
    max_tokens: 8000,
  });

  // 4. 提取 bash 代码块
  const scriptContent = extractBashBlock(response);
  if (!scriptContent) {
    return { success: false, error: 'AI 未生成有效的 bash 脚本' };
  }

  // 5. 安全检查
  const safety = safetyCheck(scriptContent);
  if (!safety.safe) {
    return { success: false, error: `安全检查未通过：${safety.reason}` };
  }

  // 6. 写入文件
  const scriptPath = path.join(projectDir, 'backend-start.sh');
  fs.writeFileSync(scriptPath, '#!/bin/bash\n' + scriptContent.replace(/^#!.*\n/, ''));
  fs.chmodSync(scriptPath, 0o755);

  // 7. 语法检查
  try {
    execFileSync('bash', ['-n', scriptPath], { encoding: 'utf8', timeout: 10000 });
  } catch (e) {
    const err = (e.stderr || e.message || '').slice(0, 500);
    // 语法错误不阻塞，但记录警告
    console.warn(`[generate-start-script] 语法检查警告: ${err}`);
    onChunk?.(`\n\n⚠️ 脚本语法检查有警告：${err}\n`);
  }

  onChunk?.(`\n\n✅ 启动脚本已生成：${scriptPath}\n`);

  return { success: true, scriptPath };
}
