// Akio <3: Project source maintained by Akio Zaki Salomon.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../../frontend/js/onboarding-config.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../../frontend/js/onboarding.js', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');

function engineHarness() {
  const listeners = {};
  const window = { addEventListener(name, listener) { listeners[name] = listener; } };
  vm.runInNewContext(engineSource, { window, console, localStorage: {}, location: {} });
  return window.ACETutorial;
}

test('every tutorial step has editable required content and a valid selector', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  for (const [role, tutorial] of Object.entries(context.window.ACETutorialConfig)) {
    assert.ok(['USER', 'ADMIN'].includes(role));
    assert.ok(Number.isInteger(tutorial.version) && tutorial.version >= 1);
    assert.ok(Array.isArray(tutorial.steps) && tutorial.steps.length > 0);
    for (const step of tutorial.steps) {
      assert.match(step.page, /^[a-z0-9-]+\.html$/);
      assert.equal(typeof step.title, 'string'); assert.ok(step.title.trim());
      assert.equal(typeof step.body, 'string'); assert.ok(step.body.trim());
      assert.equal(typeof step.target, 'string'); assert.ok(step.target.trim());
      if (step.navigation) {
        assert.equal(typeof step.navigation.group, 'string'); assert.ok(step.navigation.group.trim());
        assert.equal(typeof step.navigation.label, 'string'); assert.ok(step.navigation.label.trim());
      }
      // Keep editable targets to one stable ID or class. Both are valid CSS
      // selectors without requiring a browser DOM in this unit test.
      assert.match(step.target, /^(?:#[A-Za-z][A-Za-z0-9_-]*|\.[A-Za-z][A-Za-z0-9_-]*)$/, `${role}: ${step.target}`);
    }
  }
});

test('administrator tutorial covers every primary administration workflow', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  const steps = context.window.ACETutorialConfig.ADMIN.steps;
  const pages = new Set(steps.map(step => step.page));
  for (const page of [
    'admin-dashboard.html', 'access-requests.html', 'users.html',
    'departments.html', 'projects.html', 'schedule-flex.html', 'admin-time-entries.html',
    'reports.html', 'individual-reports.html',
    'audit-logs.html', 'settings.html'
  ]) assert.ok(pages.has(page), `Admin tutorial should cover ${page}`);
  assert.ok(steps.some(step => step.page === 'users.html' && /invitation/i.test(step.title)), 'Admin tutorial should explain invitation management from Users');
  assert.ok(steps.some(step => step.page === 'admin-time-entries.html' && /deleted/i.test(step.title)), 'Admin tutorial should explain deleted-entry recovery from Time entries');
  assert.ok(steps.length >= 18, 'Admin tutorial should be detailed enough to explain its distinct tools');
});

test('every administrator tutorial target exists on its configured page', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  for (const step of context.window.ACETutorialConfig.ADMIN.steps) {
    assert.match(step.target, /^#[A-Za-z][A-Za-z0-9_-]*$/, 'Admin steps should use durable ID targets');
    const markup = readFileSync(new URL(`../../frontend/${step.page}`, import.meta.url), 'utf8');
    assert.ok(markup.includes(`id="${step.target.slice(1)}"`), `${step.target} should exist in ${step.page}`);
  }
});

test('tutorial launch rules welcome, resume, or stay quiet as appropriate', () => {
  const tutorial = engineHarness();
  const config = { version: 1, steps: [{}] };
  const user = { Status: 'ACTIVE' };
  assert.equal(tutorial.launchMode(user, config, { status: 'NOT_STARTED' }), 'WELCOME');
  assert.equal(tutorial.launchMode(user, config, { status: 'IN_PROGRESS' }), 'RESUME');
  assert.equal(tutorial.launchMode(user, config, { status: 'COMPLETED' }), 'NONE');
  assert.equal(tutorial.launchMode(user, config, { status: 'SKIPPED' }), 'NONE');
  assert.equal(tutorial.launchMode({ Status: 'PENDING' }, config, { status: 'NOT_STARTED' }), 'NONE');
  assert.equal(tutorial.launchMode({ Status: 'DENIED' }, config, { status: 'IN_PROGRESS' }), 'NONE');
});

test('tutorial updates preserve a prior skip or completion choice', () => {
  assert.match(engineSource, /\['SKIPPED', 'COMPLETED'\]\.includes\(state\.status\)/, 'A tutorial update must respect an existing skip or completion choice');
  assert.match(engineSource, /await persist\(\{ status: state\.status, step: state\.step \}\)/, 'A skipped or completed tutorial should be silently updated to the current version');
});

test('tutorial guides navigation instead of forcing a page change', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(engineSource, /location\.assign\(`\/\$\{step\.page/, 'Tutorial steps must not navigate pages automatically');
  assert.match(engineSource, /showNavigationStep/, 'Tutorial should explain where to navigate');
  assert.match(engineSource, /ace:route-ready/, 'Tutorial should resume after shell navigation');
  assert.match(engineSource, /shell-mobile-open/, 'Tutorial should detect a closed mobile sidebar');
  assert.match(engineSource, /shell-collapsed/, 'Tutorial should detect a collapsed desktop sidebar');
  assert.match(engineSource, /aria-label="Expand sidebar"/, 'Tutorial should recognize an icon-only desktop sidebar from its expand control');
  assert.match(engineSource, /prepareNavigationTarget/, 'Tutorial should prepare and visibly point to the destination instead of leaving navigation abstract');
  assert.match(engineSource, /\.shell-collapse/, 'Tutorial should highlight the collapsed sidebar control before a destination link');
  assert.match(engineSource, /document\.querySelector\('\.shell-collapse'\)\?\.click\(\)/, 'Tutorial should reveal a collapsed desktop sidebar before pointing to a destination');
  assert.match(engineSource, /document\.querySelector\('\.shell-mobile-toggle'\)\?\.click\(\)/, 'Tutorial should reveal the mobile sidebar before pointing to a destination');
  assert.match(engineSource, /groupToggle\.click\(\)/, 'Tutorial should reveal a closed navigation group before pointing to a destination');
  assert.match(engineSource, /MutationObserver/, 'Tutorial should refresh only after the shell has actually changed its sidebar state');
  assert.match(engineSource, /ace:sidebar-state-change/, 'Tutorial should react to every state update emitted by the real sidebar controls');
  assert.match(engineSource, /shell-account-menu \[role="menuitem"\]/, 'Tutorial should adapt after the account menu is opened');
  assert.match(engineSource, /accountMenu\?\.hidden !== false/, 'Tutorial should highlight the visible account control before its hidden menu item');
  assert.match(engineSource, /target === accountToggle/, 'Tutorial should update its highlight after the account menu opens');
  assert.match(engineSource, /return showNavigationStep\(stepIndex, roleConfig\.steps\[stepIndex\]\)/, 'Mobile navigation should reopen the guide and highlight the requested destination after opening the sidebar');
  assert.match(engineSource, /mobileSidebarOpen/, 'Mobile navigation should remove the open-sidebar action after the drawer is visible');
  assert.match(engineSource, /Math\.min\(235, availableHeight - afterScroll\.height - 12\)/, 'Mobile target positioning should avoid unnecessary scrolling');
  assert.match(engineSource, /ace-tutorial-mobile-top-card/, 'Mobile account guidance should keep bottom account controls visible above the tutorial card');
  assert.match(engineSource, /card\.dataset\.placement = 'below'/, 'Mobile bottom-sheet guidance should point upward at its target');
  assert.match(engineSource, /card\.dataset\.placement = 'above'/, 'Mobile top-card guidance should point downward at its target');
  assert.match(styles, /\.ace-tutorial-card\.ace-tutorial-mobile-top-card/, 'Mobile account tutorial cards should render at the top of the screen');
  assert.match(styles, /\.ace-tutorial-card\[data-placement="below"\]::after/, 'Mobile tutorial cards should display a directional pointer arrow');
  assert.match(engineSource, /target\.matches\('\.shell-collapse'\)/, 'Sidebar-edge control should receive dedicated pointer placement');
  assert.match(engineSource, /card\.dataset\.placement = 'right'/, 'Sidebar-edge tutorial card should point left at the real control');
  assert.match(styles, /\.ace-tutorial-target\.shell-collapse/, 'Tutorial should keep the actual sidebar expand control visible while highlighting it');
  assert.match(styles, /\.ace-tutorial-target\.shell-collapse \{ position: fixed !important;/, 'Highlighting must preserve the real edge control position');
  assert.match(engineSource, /shell-nav-group-items/, 'Tutorial should detect a closed sidebar group');
  assert.match(engineSource, /navigationTarget/, 'Tutorial should identify the exact sidebar control to use');
  assert.match(engineSource, /ace-tutorial-navigation-overlay/, 'Tutorial navigation overlay should allow sidebar interaction');
  assert.doesNotMatch(engineSource, /\$\{isMobile\(\) \? 'Open sidebar' : 'Use sidebar'\}/, 'Desktop navigation should not show a redundant Use sidebar button');
  assert.match(engineSource, /if \(isMobile\(\) && !document\.body\.classList\.contains\('shell-mobile-open'\)\)/, 'Tutorial should reveal the mobile sidebar before teaching a destination');
});

test('the bell notification button owns its menu handler and the theme toggle stays desktop-only', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(shellSource, /suppliedIconMarkup\('bell', 'shell-icon'\)/, 'Notifications should use a bell icon');
  assert.match(shellSource, /topbar\.querySelector\('\.shell-topbar-notification-wrap \.shell-topbar-icon-button'\)/, 'Notification behavior must bind to the envelope button inside its own wrapper');
  assert.doesNotMatch(shellSource, /const notificationButton = topbar\.querySelector\('\.shell-topbar-icon-button'\)/, 'Notification behavior must not bind to the first top-bar icon');
  assert.match(shellSource, /themeToggle\.addEventListener\('click'/, 'The desktop theme control should switch the saved theme preference');
  assert.match(styles, /@media \(max-width: 900px\) \{\s*\.shell-theme-toggle \{ display: none; \}/, 'The theme control must remain hidden on mobile');
  assert.match(shellSource, /notificationButton\.addEventListener\('click'/, 'The bell button must open and close its notification panel');
});

test('every application page references the same shell-script version', () => {
  const pages = [
    'access-requests.html', 'admin-dashboard.html', 'admin-time-entries.html', 'audit-logs.html',
    'chat-log.html', 'deleted-time-entries.html', 'deleted-users.html', 'departments.html',
    'employee-profile.html', 'index.html', 'individual-reports.html', 'invitations.html', 'login.html',
    'projects.html', 'remarks.html', 'reports.html', 'schedule-flex.html', 'settings.html',
    'time-entries.html', 'time-entry-details.html', 'user-dashboard.html', 'users.html'
  ];
  const versions = new Set(pages.map(page => {
    const markup = readFileSync(new URL(`../../frontend/${page}`, import.meta.url), 'utf8');
    return markup.match(/js\/script\.js\?v=([^'"\s]+)/)?.[1];
  }));
  assert.equal(versions.size, 1, 'Every page must request the same shell script revision');
  assert.ok([...versions][0], 'Pages must include a cache-busted shell script revision');
});

test('late schedule notices have a dedicated dark-theme treatment', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(shellSource, /notice\.classList\.toggle\('is-late', isLate\)/, 'The dashboard should label late notices instead of treating every schedule message alike');
  assert.match(styles, /html\[data-theme="dark"\] \.employee-schedule-notice\.is-late/, 'Late notices must have a readable dark-theme surface');
  assert.match(styles, /html\[data-theme="dark"\] \.admin-dashboard #reviewAlertsSection/, 'The time-entry alert banner needs its own dark-theme surface');
  assert.match(styles, /html\[data-theme="dark"\] \.review-alert-card/, 'Time-entry alert cards need a distinct dark-theme surface');
  assert.match(styles, /html\[data-theme="dark"\] \.review-alert-icon \.ui-icon/, 'Alert-card icons must remain visible in dark mode');
});

test('employee time-entry navigation matches the visible sidebar label', () => {
    const context = { window: {} };
    vm.runInNewContext(configSource, context);
    const timeEntries = context.window.ACETutorialConfig.USER.steps.find(step => step.page === 'time-entries.html');
    assert.equal(timeEntries.navigation.label, 'My time entries');
    assert.equal(timeEntries.navigation.group, 'Work');
});

test('a collapsed desktop rail keeps Help icon-only without hiding mobile admin dropdowns', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(shellSource, /class="shell-sidebar-help" type="button" aria-label="Open Need Help" title="Need Help\?"/, 'The icon-only Help control needs an accessible name and tooltip');
  assert.match(styles, /\.shell-sidebar-help \{[\s\S]*?width: calc\(100% - 20px\);[\s\S]*?box-sizing: border-box;/, 'Help must include its padding in its sidebar width to avoid opening-time overflow');
  assert.match(styles, /@media \(min-width: 1181px\) \{[\s\S]*?\.shell-collapsed \.shell-sidebar-help > span \{ display: none; \}/, 'Collapsed desktop Help should hide only its visible label');
  assert.match(styles, /@media \(max-width: 1180px\) \{[\s\S]*?\.shell-collapsed \.shell-nav-label \{ display: block; \}[\s\S]*?\.shell-collapsed \.shell-nav-group-toggle \{ display: flex; \}/, 'A saved desktop collapse preference must not hide mobile admin dropdown triggers');
});

test('dashboard analytics render smooth time lines and scaled project bars', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(shellSource, /function smoothChartPath\(points\)/, 'Time-entry analytics should generate a smooth SVG path');
  assert.match(shellSource, /<path class="line-chart-path" d="\$\{linePath\}"/, 'The time chart should use the generated smooth path instead of a polyline');
  assert.match(shellSource, /const xGrid = points\.map\(point => `<line class="line-chart-gridline line-chart-gridline--vertical"/, 'The time chart should include vertical grid guides for each time bucket');
  assert.match(shellSource, /class="project-bar-chart"/, 'Project allocation should render as a chart container');
  assert.match(shellSource, /class="project-bar-fill" style="width:\$\{width\}%"/, 'Project values should scale each bar to the largest selected project');
  assert.match(styles, /\.admin-dashboard \.project-allocation-card \.project-allocation \{ display: grid; grid-template-columns: minmax\(0,1fr\);/, 'The allocation chart must span the full card width instead of inheriting a legacy two-column grid');
  assert.match(styles, /\.project-bar-track \{[\s\S]*?repeating-linear-gradient/, 'Project bars should show a shared grid scale');
  assert.match(styles, /\.line-chart-gridline--vertical \{ stroke: #e7f0f2;/, 'Vertical chart guides should stay visually subtle');
});

test('admin dashboard keeps its compact operations hierarchy across screen sizes', () => {
  const dashboard = readFileSync(new URL('../../frontend/admin-dashboard.html', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(dashboard, /<header class="dashboard-header" id="adminDashboardHeader">[\s\S]*?id="currentDate"/, 'The dashboard header should pair its greeting with the live date');
  assert.match(dashboard, /class="dashboard-overview"/, 'Workspace metrics should have a dedicated dashboard row');
  assert.match(styles, /\.admin-dashboard \.dashboard-command-center \{[\s\S]*?grid-template-columns: minmax\(170px,\.9fr\) minmax\(0,2\.2fr\)/, 'Quick actions should share a compact desktop action strip');
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.admin-dashboard \.dashboard-header-stats \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/, 'Small screens should retain scannable two-column status cards');
});

test('employee dashboard presents weekly time, responsive actions, and a shared dark surface', () => {
  const dashboard = readFileSync(new URL('../../frontend/user-dashboard.html', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(dashboard, /id="employeeWeekChart"/, 'Employees need a weekly time visual on their dashboard');
  assert.match(dashboard, /class="employee-quick-action-list"/, 'Employees need direct shortcuts for common actions');
  assert.match(shellSource, /const dailySeconds = Array\.from\(\{ length: 7 \}/, 'The weekly visual should derive all seven days from recorded time');
  assert.match(styles, /\.user-dashboard \{\s*--employee-card:/, 'Employee card colors should be centralized for theme consistency');
  assert.match(styles, /\.user-dashboard \.employee-status-panel \{[\s\S]*?analytics-mountain-banner-v1\.png/, 'The employee work-status surface should retain its scenic background treatment');
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.user-dashboard \.employee-dashboard-hero-grid \{ grid-template-columns: 1fr;/, 'Mobile must use a dedicated single-column employee dashboard layout');
});

test('dark navigation is flat, high-contrast, and keeps primary actions white', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(styles, /html\[data-theme="dark"\] :is\(\.app-sidebar,\.shell-brand,\.shell-account-wrap\) \{[\s\S]*?background-image: none!important;/, 'Dark sidebar surfaces must not use gradients');
  assert.match(styles, /html\[data-theme="dark"\] :is\(\.shell-link \.shell-icon,\.shell-nav-group-toggle \.shell-icon,[\s\S]*?filter: brightness\(0\) invert\(1\)!important;/, 'Dark sidebar navigation icons should be white');
  assert.match(styles, /html\[data-theme="dark"\] \.btn-primary \{[\s\S]*?background: #fff!important;/, 'Dark primary actions should use a white surface');
});

test('dark public home and sign-in pages preserve readable light-card contrast', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(styles, /html\[data-theme="dark"\] \.login-view \.login-card \{[\s\S]*?background: #fff!important;/, 'The sign-in card should remain a readable light surface in dark mode');
  assert.match(styles, /html\[data-theme="dark"\] \.login-view \.login-card \.login-title \{ color: #103d4a!important;/, 'Sign-in heading must stay dark on its light card');
  assert.match(styles, /html\[data-theme="dark"\] \.login-view :is\(\.login-brand-logo img,\.login-mobile-brand img\) \{ filter: none!important;/, 'Dark mode must not invert login brand artwork');
  assert.match(styles, /html\[data-theme="dark"\] body\.home-page:not\(\.has-app-shell\) :is\(\.nav-brand \.nav-title,\.nav-links \.nav-link\) \{ color: #eef6f7!important;/, 'Home navigation copy must be readable on the dark header');
});

test('action buttons retain visible icons after dynamic page content is added', () => {
  const styles = readFileSync(new URL('../../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(shellSource, /const addActionButtonIcon = button =>/, 'Button icon insertion should be reusable for later page content');
  assert.match(shellSource, /window\.aceActionButtonIconObserver = new MutationObserver/, 'Dynamically rendered action buttons should receive icons');
  assert.match(shellSource, /document\.querySelectorAll\('button\.btn'\)\.forEach\(addActionButtonIcon\)/, 'Existing action buttons should receive icons on first render');
  assert.match(shellSource, /button\.insertAdjacentHTML\('afterbegin', suppliedIconMarkup\(name\)\);/, 'Dynamically rendered action buttons should receive a real image icon');
  assert.doesNotMatch(shellSource, /(?:dataset\.aceButtonIcon\s*=|--ace-button-icon)/, 'Button icons must not depend on mask-only state');
  assert.match(styles, /html\[data-theme="dark"\] \.btn-primary > \.ui-icon \{[\s\S]*?filter: brightness\(0\)!important;/, 'Icons on white primary actions must remain black and visible');
  assert.match(styles, /html\[data-theme="dark"\] :is\(\.btn-secondary,\.btn-outline\) > \.ui-icon \{[\s\S]*?filter: brightness\(0\) invert\(1\)!important;/, 'Icons on dark secondary and outline actions must remain white');
  assert.doesNotMatch(styles, /html\[data-theme="dark"\] :is\([^)]*\.btn-primary \.ui-icon[^)]*\) \{[\s\S]*?--ace-icon-strong-filter/, 'A more-specific dark-theme rule must not override primary button icon contrast');
  assert.doesNotMatch(styles, /\.btn\[data-ace-button-icon\][^{]*?(?:::before)?[^{]*\{[\s\S]*?(?:-webkit-)?mask:/, 'Action icons must not use a CSS mask replacement');
  assert.doesNotMatch(styles, /\.btn\[data-ace-button-icon\]\s*>\s*\.ui-icon\s*\{\s*display:\s*none/i, 'Button image icons must remain visible');
});

test('restarting a tutorial teaches users how to return to the dashboard first', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  for (const tutorial of Object.values(context.window.ACETutorialConfig)) {
    const firstStep = tutorial.steps[0];
    assert.equal(firstStep.navigation.label, 'Dashboard');
    assert.equal(firstStep.navigation.group, 'Workspace');
  }
});
