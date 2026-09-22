// Built-in tutorial content. Each step needs a page (the source .html page),
// target (a CSS selector), title, and body. Set forcePage to true only when a
// tour must begin on that page even if the user launched it elsewhere.
window.ACETutorialConfig = {
    USER: {
        version: 2,
        steps: [
            { page: 'user-dashboard.html', target: '#mainClockInBtn', title: 'Start your shift', body: 'Start your shift here. Clock out and breaks live in the same place.', forcePage: false },
            { page: 'time-entries.html', target: '#timeEntriesList', title: 'Review your shifts', body: "Every shift you've worked, newest first." },
            { page: 'user-dashboard.html', target: '#employeeStatusPanel', title: 'Check your status', body: "Your current status, today's hours, and this week at a glance." },
            { page: 'settings.html', target: '#profileSettings', title: 'Keep your profile current', body: 'Update your name, photo, and notification preferences here.' }
        ]
    },
    ADMIN: {
        version: 2,
        steps: [
            { page: 'admin-dashboard.html', target: '.dashboard-command-center', title: 'Run the workspace', body: 'Your daily control panel — pending approvals, active staff, and quick actions.' },
            { page: 'admin-dashboard.html', target: '#inviteUserBtn', title: 'Invite your team', body: 'Add a new employee or admin. They get an email and set up their own account.' },
            { page: 'admin-time-entries.html', target: '.admin-edit-entry-time', title: 'Review team hours', body: 'Review and correct hours here.' },
            { page: 'reports.html', target: '#reportsList', title: 'Create reports', body: 'Export hours by week, month, or project for payroll.' },
            { page: 'settings.html', target: '#profileSettings', title: 'Your settings', body: 'Departments, projects, schedules, and admin preferences live here.' }
        ]
    }
};
