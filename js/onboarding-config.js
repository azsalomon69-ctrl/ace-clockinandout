// Built-in tutorial content. Each step needs a page (the source .html page),
// target (a CSS selector), title, and body. Set forcePage to true only when a
// tour must begin on that page even if the user launched it elsewhere.
window.ACETutorialConfig = {
    USER: {
        version: 1,
        steps: [
            { page: 'user-dashboard.html', target: '#employeeStatusPanel', title: 'Your workday starts here', body: 'Use this panel to clock in, take a break, and clock out.', forcePage: false },
            { page: 'user-dashboard.html', target: '#recentActivity', title: 'See recent work', body: 'Your completed shifts appear here at a glance.' },
            { page: 'time-entries.html', target: '#clockInBtn', title: 'Manage your time', body: 'Open a shift here and review your full time history.' },
            { page: 'remarks.html', target: '#remarksPageList', title: 'Read administrator notes', body: 'Check this page for feedback about your time entries.' },
            { page: 'settings.html', target: '#profileSettings', title: 'Keep your profile current', body: 'Update your name, photo, and workspace preferences here.' }
        ]
    },
    ADMIN: {
        version: 1,
        steps: [
            { page: 'admin-dashboard.html', target: '#operationsTitle', title: 'Run the workspace', body: 'Start with these quick actions to invite people and set up work.' },
            { page: 'admin-dashboard.html', target: '#analyticsTitle', title: 'Watch team activity', body: 'Use this overview to understand tracked time and team trends.' },
            { page: 'users.html', target: '#sectionTableBody', title: 'Manage people', body: 'Review users, roles, and account status from this page.' },
            { page: 'projects.html', target: '#sectionAction', title: 'Set up work', body: 'Create projects, departments, and schedules before assigning work.' },
            { page: 'admin-time-entries.html', target: '#sectionTableBody', title: 'Review time entries', body: 'Inspect team time records and resolve issues when needed.' },
            { page: 'reports.html', target: '#reportsList', title: 'Create reports', body: 'Generate, preview, and export reporting for the team.' },
            { page: 'settings.html', target: '#profileSettings', title: 'Your settings', body: 'Update your administrator profile and workspace preferences here.' }
        ]
    }
};
