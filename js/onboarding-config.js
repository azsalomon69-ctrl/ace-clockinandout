// Built-in tutorial content. Each step needs a page (the source .html page),
// target (a CSS selector), title, and body. Set forcePage to true only when a
// tour must begin on that page even if the user launched it elsewhere.
window.ACETutorialConfig = {
    USER: {
        version: 3,
        steps: [
            { page: 'user-dashboard.html', target: '#mainClockInBtn', title: 'Start your shift', body: 'Start your shift here. Clock out and breaks live in the same place.', forcePage: false, navigation: { group: 'Workspace', label: 'Dashboard' } },
            { page: 'time-entries.html', target: '#timeEntriesList', title: 'Review your shifts', body: "Every shift you've worked, newest first.", navigation: { group: 'Work', label: 'My time entries' } },
            { page: 'user-dashboard.html', target: '#employeeStatusPanel', title: 'Check your status', body: "Your current status, today's hours, and this week at a glance.", navigation: { group: 'Workspace', label: 'Dashboard' } },
            { page: 'settings.html', target: '#profileSettings', title: 'Keep your profile current', body: 'Update your name, photo, and notification preferences here.', navigation: { group: 'Account', label: 'Profile & settings' } }
        ]
    },
    ADMIN: {
        // Bump this whenever administrator guidance materially changes so
        // existing admins are offered the improved tour again.
        version: 4,
        steps: [
            { page: 'admin-dashboard.html', target: '#operationsTitle', title: 'Your admin dashboard', body: 'This is your daily control centre. Use it to see active staff, recent entries, and the actions that need attention.', navigation: { group: 'Workspace', label: 'Dashboard' } },
            { page: 'admin-dashboard.html', target: '#inviteUserBtn', title: 'Invite a team member', body: 'Choose Invite user to pre-authorize an employee or another administrator. Their access is created first, then the system sends the onboarding email.' },
            { page: 'admin-dashboard.html', target: '#generateReportBtn', title: 'Generate a company report', body: 'Choose a month, optional department or project filters, then save the report as a PDF or Excel workbook.' },
            { page: 'admin-dashboard.html', target: '#analyticsFilters', title: 'Filter the live analytics', body: 'Use the period, project, department, and employee filters here to focus the hours chart, allocation summary, and leaderboard.' },
            { page: 'access-requests.html', target: '#accessRequestTable', title: 'Approve access requests', body: 'People who sign in before they are invited appear here. Review their Google account before the 24-hour request window expires, then approve or deny it.', navigation: { group: 'People', label: 'Access requests' } },
            { page: 'users.html', target: '#sectionSearch', title: 'Manage user accounts', body: 'Search staff, filter by department or account type, then use Review or Manage to approve pending people, change a role, assign a department, or archive an account.', navigation: { group: 'People', label: 'Users' } },
            { page: 'invitations.html', target: '#sectionAction', title: 'Track and cancel invitations', body: 'Use Invite user for another invitation. Select a pending invitation in the table to review it or cancel it when access is no longer needed.', navigation: { group: 'People', label: 'Invitations' } },
            { page: 'departments.html', target: '#sectionAction', title: 'Set up departments', body: 'Create departments before assigning employees to them. Use the table actions to edit a department or remove one that is no longer used.', navigation: { group: 'People', label: 'Departments' } },
            { page: 'projects.html', target: '#sectionAction', title: 'Set up projects', body: 'Create the projects that employees can select while tracking time. Keep names clear so reports and time entries stay easy to read.', navigation: { group: 'Work', label: 'Projects' } },
            { page: 'schedule-flex.html', target: '#scheduleForm', title: 'Create schedules and flextime', body: 'Set the schedule name, fixed or flex type, workdays, expected hours, and break limit. At least one working day is required.', navigation: { group: 'Work', label: 'Schedule & flextime' } },
            { page: 'schedule-flex.html', target: '#assignmentForm', title: 'Assign a schedule', body: 'After creating a schedule, choose an active employee and assign it here. This connects the employee to the working-day and break rules.' },
            { page: 'admin-time-entries.html', target: '#sectionSearch', title: 'Review team time entries', body: 'Search entries and use the employee, project, and remarks filters to find a record. This view includes active entries, completed work, breaks, and administrator remarks.', navigation: { group: 'Work', label: 'Time entries' } },
            { page: 'admin-time-entries.html', target: '#sectionTableBody', title: 'Correct or remove time safely', body: 'For an entry, use Correct time only for a genuine missed or incorrect clock-in or clock-out. Add an internal remark when context matters. Delete moves the entry to Deleted time entries so it can be restored.' },
            { page: 'deleted-time-entries.html', target: '#deletedTimeEntriesTable', title: 'Restore deleted time entries', body: 'Deleted entries are excluded from normal dashboards and reports. Review this list and restore an entry when it was removed by mistake.', navigation: { group: 'Work', label: 'Deleted time entries' } },
            { page: 'reports.html', target: '#reportsList', title: 'Open generated reports', body: 'Every report created from the dashboard is kept here. Open a report to preview it, save it as PDF or Excel, or delete an obsolete export.', navigation: { group: 'Insights', label: 'Reports' } },
            { page: 'individual-reports.html', target: '#individualReportForm', title: 'Prepare individual reports', body: 'Choose a reporting month and optionally one employee. Leave the employee blank to prepare a separate report for every active employee.', navigation: { group: 'Insights', label: 'Individual reports' } },
            { page: 'audit-logs.html', target: '#sectionSearch', title: 'Review the audit log', body: 'Search the read-only history of important actions, such as approvals, account changes, time corrections, and report exports.', navigation: { group: 'Administration', label: 'Audit log' } },
            { page: 'settings.html', target: '#profileSettings', title: 'Update your administrator profile', body: 'Keep your own display name and photo current. This affects how your name appears across administrative records.', navigation: { group: 'Administration', label: 'Settings' } },
            { page: 'settings.html', target: '#securityTab', title: 'Review account security', body: 'Open Security to see the sign-in and account-protection options available for your administrator account.' },
            { page: 'settings.html', target: '#appearanceTab', title: 'Choose display preferences', body: 'Open Appearance to adjust display preferences such as text size and compact mode for your own workspace.' }
        ]
    }
};
