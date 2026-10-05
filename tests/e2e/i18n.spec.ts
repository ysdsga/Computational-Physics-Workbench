import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

// All fixture files stay inside the isolated checkout, never in a research directory.
const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
fs.mkdirSync(path.join(checkout, '.review'), { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(checkout, '.review', 'i18n-e2e-'));
let server: ChildProcess | undefined;

test.use({ locale: 'en-US' });

test.beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: checkout,
    windowsHide: true,
    env: {
      ...process.env,
      WORKBENCH_DB_PATH: path.join(tempRoot, 'test.db'),
      WORKBENCH_HOST: '127.0.0.1', WORKBENCH_PORT: '5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    server!.once('error', reject);
    server!.once('exit', code => reject(new Error(`Isolated i18n server exited (${code}): ${output}`)));
    server!.stderr!.on('data', chunk => { output += String(chunk); });
    server!.stdout!.on('data', chunk => {
      output += String(chunk);
      if (output.includes('Server running at http://127.0.0.1:5173')) resolve();
    });
  });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    await new Promise<void>(resolve => {
      server!.once('exit', () => resolve());
      server!.kill();
    });
  }
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* Transient Windows handles. */ }
});

test('English browser opens English navigation and all primary pages', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: /Projects|Project repository/i })).toBeVisible();
  for (const route of ['/workflow', '/research-plans', '/agent-runs', '/reviews', '/supercomputers', '/evidence', '/experiences']) {
    await page.locator(`nav a[href="#${route}"]`).click();
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading').first()).not.toHaveText(/[\u3400-\u9fff]/);
    await expect(page.locator('nav')).not.toContainText(/[\u3400-\u9fff]/);
    if (route === '/workflow') {
      const templates = page.locator('main select').filter({ has: page.locator('option[value="theoretical-research"]') });
      const options = templates.locator('option');
      await expect(options).toHaveCount(4);
      expect(await options.evaluateAll(items => items.map(item => (item as HTMLOptionElement).value))).toContain('dft-dmft-oneshot');
      for (const option of await options.all()) await expect(option).not.toHaveText(/[\u3400-\u9fff]/);
      await page.screenshot({ path: path.join(checkout, '.review', 'english-workflow.png'), fullPage: true });
      await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('zh-CN');
      await expect(page.getByRole('heading', { name: '工作流', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(checkout, '.review', 'chinese-workflow.png'), fullPage: true });
      await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en');
    }
  }
});

for (const missingLanguages of ['missing', 'empty'] as const) {
  test(`browser falls back to navigator.language when navigator.languages is ${missingLanguages}`, async ({ page }) => {
    await page.addInitScript(mode => {
      Object.defineProperty(navigator, 'languages', { get: () => mode === 'missing' ? undefined : [] });
      Object.defineProperty(navigator, 'language', { get: () => 'zh-TW' });
    }, missingLanguages);
    await page.goto('/#/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', { name: '项目仓库', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}

test('language choice updates the page immediately and persists after reload', async ({ page }) => {
  await page.goto('/#/');
  const language = page.getByRole('combobox', { name: 'Language / 语言' });
  await language.selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: '项目仓库', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '项目仓库', exact: true })).toBeVisible();
  await expect(language).toHaveValue('zh-CN');
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: /Projects|Project repository/i })).toBeVisible();
  await page.reload();
  await expect(language).toHaveValue('en');
});

test('disabled browser storage still allows rendering and session language changes', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage disabled by fixture', 'SecurityError'); },
    });
  });
  await page.goto('/#/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const language = page.getByRole('combobox', { name: 'Language / 语言' });
  await language.selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '项目仓库', exact: true })).toBeVisible();
  await language.selectOption('en');
  await expect(page.getByRole('heading', { name: /Projects|Project repository/i })).toBeVisible();
});

test('language preference synchronizes across tabs without reloading', async ({ page, context }) => {
  await page.goto('/#/');
  const second = await context.newPage();
  await second.goto('/#/');
  await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('zh-CN');
  await expect(second.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(second.getByRole('heading', { name: '项目仓库', exact: true })).toBeVisible();
  await second.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: /Projects|Project repository/i })).toBeVisible();
  await second.close();
});

test('English task form validates, reports errors and preserves task/workflow identities', async ({ page, request }) => {
  const workingDir = path.join(tempRoot, 'english-project');
  fs.mkdirSync(workingDir);
  const created = await request.post('/api/projects', { data: { name: 'English research project', working_dir: workingDir } });
  expect(created.ok()).toBeTruthy();
  const project = await created.json() as { id: string };
  await page.goto(`/#/project/${project.id}`);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a task name.');
  const language = page.getByRole('combobox', { name: 'Language / 语言' });
  await language.selectOption('zh-CN');
  await expect(page.getByRole('alert')).toHaveText('请输入任务名称。');
  await language.selectOption('en');
  await expect(page.getByRole('alert')).toHaveText('Enter a task name.');

  await page.getByPlaceholder(/V2O3.*one-shot DMFT/i).fill('English UI task');
  const workflow = page.getByRole('combobox', { name: 'Workflow template', exact: true });
  await expect(workflow.locator('option[value="theoretical-research"]')).not.toHaveText(/[\u3400-\u9fff]/);
  await workflow.selectOption('theoretical-research');

  let rejectNext = true;
  await page.route(`**/api/projects/${project.id}/tasks`, async route => {
    if (route.request().method() === 'POST' && rejectNext) {
      rejectNext = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture unavailable' }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/Creation failed[:：] ?Fixture unavailable|Failed to create[:：] ?Fixture unavailable|Create failed[:：] ?Fixture unavailable/i);
  await language.selectOption('zh-CN');
  await expect(page.getByRole('alert')).toHaveText(/创建失败[:：] ?Fixture unavailable/);
  await expect(page.getByPlaceholder(/V2O3.*one-shot DMFT/i)).toHaveValue('English UI task');
  await language.selectOption('en');
  await expect(page.getByRole('alert')).toHaveText(/Creation failed[:：] ?Fixture unavailable/);
  await expect(page.getByPlaceholder(/V2O3.*one-shot DMFT/i)).toHaveValue('English UI task');
  await expect(workflow).toHaveValue('theoretical-research');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByText('English UI task', { exact: true })).toBeVisible();
  const tasks = await request.get(`/api/projects/${project.id}/tasks`).then(response => response.json()) as Array<{ name: string; workflow_id: string; task_root_rel: string }>;
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ name: 'English UI task', workflow_id: 'theoretical-research' });
  expect(fs.statSync(path.join(workingDir, tasks[0].task_root_rel)).isDirectory()).toBeTruthy();
});

test('file preview error updates on language change while successful file content stays verbatim', async ({ page, request }) => {
  const workingDir = path.join(tempRoot, 'file-preview-project');
  fs.mkdirSync(workingDir);
  const content = '无法读取文件: This is researcher-authored text, not an application error. ΔΣ(iω)';
  fs.writeFileSync(path.join(workingDir, 'research-note.txt'), content, 'utf8');
  const response = await request.post('/api/projects', { data: { name: 'File preview fixture', working_dir: workingDir } });
  expect(response.ok()).toBeTruthy();
  const project = await response.json() as { id: string };
  const readRoute = `**/api/projects/${project.id}/files/read?*`;
  await page.route(readRoute, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture read error 原文' }) }));
  await page.goto(`/#/project/${project.id}`);
  await page.getByRole('button', { name: 'Project files', exact: true }).click();
  await page.getByText('research-note.txt', { exact: true }).click();
  const preview = page.locator('main pre');
  await expect(preview).toHaveText('[Unable to read file: Fixture read error 原文]');
  const language = page.getByRole('combobox', { name: 'Language / 语言' });
  await language.selectOption('zh-CN');
  await expect(preview).toHaveText('[无法读取文件: Fixture read error 原文]');
  await language.selectOption('en');
  await expect(preview).toHaveText('[Unable to read file: Fixture read error 原文]');

  await page.unroute(readRoute);
  await page.reload();
  await page.getByRole('button', { name: 'Project files', exact: true }).click();
  await page.getByText('research-note.txt', { exact: true }).click();
  await expect(preview).toHaveText(content);
  await language.selectOption('zh-CN');
  await expect(preview).toHaveText(content);
  await language.selectOption('en');
  await expect(preview).toHaveText(content);
});

test('research plan read failures localize without becoming editable or replacing stored content', async ({ page, request }) => {
  const workingDir = path.join(tempRoot, 'plan-error-project');
  fs.mkdirSync(workingDir);
  const projectResponse = await request.post('/api/projects', { data: { name: 'Plan error fixture', working_dir: workingDir } });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json() as { id: string };
  const content = '# Preserved research plan\n\n研究者原文 ΔΣ(iω): do not replace this with an error.';
  const planResponse = await request.post('/api/research-plans', { data: { title: 'Plan read failure fixture', project_id: project.id, content } });
  expect(planResponse.ok()).toBeTruthy();
  const plan = await planResponse.json() as { id: string };
  const contentPath = `/api/research-plans/${plan.id}/content`;
  const before = await request.get(contentPath).then(response => response.json());
  expect(before.content).toBe(content);
  const contentWrites: string[] = [];
  page.on('request', outgoing => {
    if (outgoing.url().endsWith(contentPath) && outgoing.method() !== 'GET') contentWrites.push(outgoing.method());
  });
  await page.route(`**${contentPath}`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture plan failure 原文' }) }));
  await page.goto(`/#/research-plans?id=${plan.id}`);
  await expect(page.getByRole('alert')).toHaveText('Unable to read: Fixture plan failure 原文');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save content', exact: true })).toHaveCount(0);
  const language = page.getByRole('combobox', { name: 'Language / 语言' });
  await language.selectOption('zh-CN');
  await expect(page.getByRole('alert')).toHaveText('无法读取：Fixture plan failure 原文');
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存正文', exact: true })).toHaveCount(0);
  await language.selectOption('en');
  await expect(page.getByRole('alert')).toHaveText('Unable to read: Fixture plan failure 原文');
  const afterError = await request.get(contentPath).then(response => response.json());
  expect(afterError.content).toBe(content);
  expect(afterError.sha256).toBe(before.sha256);
  expect(contentWrites).toEqual([]);

  await page.unroute(`**${contentPath}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Preserved research plan', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('textarea')).toHaveValue(content);
  expect(contentWrites).toEqual([]);
});

test('legacy HPC app copy follows locale while authored profiles and open drafts remain intact', async ({ page }) => {
  const notes = '旧版单根目录配置；请改为登记用户只读根和项目根。';
  const projects = [
    { id: 'legacy-review', name: 'Legacy fixture', hpc_config: JSON.stringify({ host: 'legacy-alias', remotePath: '/remote/legacy' }) },
    { id: 'modern-review', name: 'Authored fixture', hpc_config: JSON.stringify({ profiles: [{ id: 'legacy-modern-review', name: '原有配置', notes, sshAlias: 'fixture', userRoot: '/remote/user', projectRoot: '/remote/user/project', scheduler: 'LSF' }] }) },
  ];
  const writes: string[] = [];
  page.on('request', outgoing => {
    if (new URL(outgoing.url()).pathname.startsWith('/api/') && outgoing.method() !== 'GET') writes.push(outgoing.method());
  });
  await page.route('**/api/projects', route => route.fulfill({ json: projects }));
  await page.route('**/api/projects/*/tasks', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => localStorage.setItem('workbench.locale', 'zh-CN'));
  await page.goto('/#/supercomputers');
  const language = page.getByRole('combobox', { name: 'Language / 语言' });
  await expect(page.getByRole('heading', { name: '原有配置', exact: true })).toBeVisible();
  await language.selectOption('en');
  await expect(page.getByRole('heading', { name: 'Legacy configuration', exact: true })).toBeVisible();
  await expect(page.getByText('Legacy single-root configuration. Register the read-only user root and project root instead.', { exact: true })).toBeVisible();
  await page.getByTitle('Edit profile', { exact: true }).click();
  const name = page.getByLabel(/^(Display name|显示名称)$/);
  const note = page.getByLabel(/^(Notes and login boundaries|说明与登录边界)/);
  const userRoot = page.getByLabel(/^(Read-only user root|用户只读根)$/);
  const projectRoot = page.getByLabel(/^(Remote project root|远程项目根)$/);
  await name.fill('研究者 draft');
  await note.fill('自定义说明 — preserve');
  await userRoot.fill('/remote/draft-user');
  await projectRoot.fill('/remote/draft-user/project');
  for (const locale of ['zh-CN', 'en']) {
    await language.selectOption(locale);
    await expect(name).toHaveValue('研究者 draft');
    await expect(note).toHaveValue('自定义说明 — preserve');
    await expect(userRoot).toHaveValue('/remote/draft-user');
    await expect(projectRoot).toHaveValue('/remote/draft-user/project');
    await expect(page.getByRole('heading', { name: locale === 'en' ? 'Legacy configuration' : '原有配置', exact: true })).toBeVisible();
  }
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('modern-review');
  for (const locale of ['en', 'zh-CN', 'en']) {
    await language.selectOption(locale);
    await expect(page.getByRole('heading', { name: '原有配置', exact: true })).toBeVisible();
    await expect(page.getByText(notes, { exact: true })).toBeVisible();
  }
  expect(writes).toEqual([]);
});

test('locale switching leaves researcher text and stored workflow records unchanged', async ({ page, request }) => {
  // Deliberately use application-like Chinese text: user content must never be dictionary-translated.
  const name = '项目仓库';
  const description = '研究方案：保持原文 ΔΣ(iω)';
  const response = await request.post('/api/projects', { data: { name, description } });
  expect(response.ok()).toBeTruthy();
  const project = await response.json() as { id: string };
  const before = await request.get('/api/workflows/all/full').then(result => result.json());
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('zh-CN');
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language / 语言' }).selectOption('en');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const stored = await request.get(`/api/projects/${project.id}`).then(result => result.json());
  expect(stored).toMatchObject({ name, description });
  expect(await request.get('/api/workflows/all/full').then(result => result.json())).toEqual(before);
});

test('English template preview and metadata edits preserve stored scientific content', async ({ page, request, context }) => {
  const workflowId = 'theoretical-research';
  const original = await request.get(`/api/workflows/${workflowId}`).then(response => response.json());
  await page.goto('/#/workflow');
  const templates = page.locator('main select').filter({ has: page.locator(`option[value="${workflowId}"]`) });
  await templates.selectOption(workflowId);
  await page.getByRole('button', { name: 'Edit template', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit workflow template', exact: true })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('You can customize fields in English or Chinese.');
  await expect(page.getByRole('note')).toContainText('The English preview is read-only and does not change field values.');
  await page.getByText('English preview of built-in workflow content', { exact: true }).click();
  const preview = page.locator('details');
  await expect(preview).not.toContainText(/[\u3400-\u9fff]/);
  // The first two inputs are template metadata. Preview strings must not replace these stored values.
  const name = page.locator('main input').nth(0);
  const description = page.locator('main input').nth(1);
  await expect(name).toHaveValue(original.name);
  await expect(description).toHaveValue(original.description);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  const editedName = `${original.name} — English-session edit`;
  await name.fill(editedName);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const preferencePage = await context.newPage();
  await preferencePage.goto('/#/');
  const language = preferencePage.getByRole('combobox', { name: 'Language / 语言' });
  await language.selectOption('zh-CN');
  await expect(page.getByRole('note')).toContainText('字段可用英文或中文自定义。');
  await expect(page.getByRole('heading', { name: '保存模板', exact: true })).toBeVisible();
  await expect(page.getByText('确定要保存对工作流模板的修改吗？', { exact: false })).toBeVisible();
  await expect(name).toHaveValue(editedName);
  await language.selectOption('en');
  await expect(page.getByRole('heading', { name: 'Save template', exact: true })).toBeVisible();
  await expect(page.getByText('Save changes to this workflow template?', { exact: false })).toBeVisible();
  await expect(name).toHaveValue(editedName);
  await preferencePage.close();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  const saved = await request.get(`/api/workflows/${workflowId}`).then(response => response.json());
  expect(saved).toEqual({ ...original, name: editedName });
  // Restore the disposable fixture so subsequent tests need not depend on test order.
  expect((await request.put(`/api/workflows/${workflowId}`, { data: original })).ok()).toBeTruthy();
});
