// Akio <3: Project source maintained by Akio Zaki Salomon.
// Built-in tutorial content. Each step needs a page (the source .html page),
// target (a CSS selector), title, and body. Set forcePage to true only when a
// tour must begin on that page even if the user launched it elsewhere.
window.ACETutorialConfig = {
    USER: {
        version: 6,
        steps: [
            { page: 'user-dashboard.html', target: '#mainClockInBtn', title: 'Start and finish your shift', body: 'Start your shift here. Clock out is available in the same place and requires a short official clock-out note; clock-in notes are not used.', forcePage: false, navigation: { group: 'Workspace', label: 'Dashboard' } },
            { page: 'time-entries.html', target: '#timeEntriesList', title: 'Review your shifts', body: "Every shift you've worked, newest first.", navigation: { group: 'Work', label: 'My time entries' } },
            { page: 'time-entries.html', target: '#applyFiltersBtn', title: 'Find a past shift', body: 'Filter by date, project, or status to narrow your recorded time. Open View on a row for the clock-out note and full details.' },
            { page: 'remarks.html', target: '#remarksPageList', title: 'Read administrator remarks', body: 'Administrators can leave feedback on a time entry. Review related comments here whenever you see a remark notification.', navigation: { group: 'Work', label: 'Remarks' } },
            { page: 'user-dashboard.html', target: '#employeeStatusPanel', title: 'Check your status', body: 'This work-status card shows whether you are clocked in, your local time, and the session facts once a shift is active.', navigation: { group: 'Workspace', label: 'Dashboard' } },
            { page: 'user-dashboard.html', target: '#employeeWeekChart', title: 'Review time this week', body: 'This seven-day chart summarizes completed hours, entry count, and your average daily time for the current week.' },
            { page: 'user-dashboard.html', target: '#employeeQuickActions', title: 'Use quick actions', body: 'These shortcuts take you straight to your time entries, administrator remarks, and profile settings.' },
            { page: 'settings.html', target: '#profileSettings', title: 'Keep your profile current', body: 'Update your name, photo, and notification preferences here.', navigation: { group: 'Account', label: 'Profile & settings' } }
        ]
    },
    ADMIN: {
        // Bump this whenever administrator guidance materially changes so
        // existing admins are offered the improved tour again.
        version: 12,
        steps: [
            { page: 'admin-dashboard.html', target: '#adminDashboardHeader', title: 'Your admin dashboard', body: 'Start here each day. This header orients you with the current date before you review live work and operational priorities.', navigation: { group: 'Workspace', label: 'Dashboard' } },
            { page: 'admin-dashboard.html', target: '#dashboardQuickActions', title: 'Use quick actions', body: 'These action buttons are the fastest way to invite a team member or open departments, projects, and schedules.' },
            { page: 'admin-dashboard.html', target: '#dashboardOverview', title: 'Read workspace status', body: 'These cards summarize people clocked in, online activity, today’s entries, and completed time for the current month.' },
            { page: 'admin-dashboard.html', target: '#inviteUserBtn', title: 'Invite a team member', body: 'Choose Invite user to pre-authorize an employee or another administrator. Their access is created first, then the system sends the onboarding email.' },
            { page: 'admin-dashboard.html', target: '#trackedTimeRange', title: 'Read the live analytics', body: 'Use the date selector on each chart to compare completed time or project allocation. Export company time entries from Work → Time entries, or prepare employee reports in Insights → Individual reports.' },
            { page: 'admin-dashboard.html', target: '#reviewAlertsList', title: 'Review time-entry alerts', body: 'When this section appears, it flags a possible missed clock-out or an administrator-stopped shift. Open the entry, confirm the facts with the employee, then correct it only when needed.', optional: true },
            { page: 'access-requests.html', target: '#accessRequestTable', title: 'Approve access requests', body: 'People who sign in before they are invited appear here. Review their Google account before the 24-hour request window expires, then approve or deny it.', navigation: { group: 'People', label: 'Access requests' } },
            { page: 'users.html', target: '#sectionSearch', title: 'Manage user accounts', body: 'Search staff, filter by department or account type, then use Manage to update a person’s role, department, project, and schedule. The Users page also shows who is online and when others were last seen.', navigation: { group: 'People', label: 'Users' } },
            { page: 'users.html', target: '#sectionSearch', title: 'Track and cancel invitations', body: 'Use the Invitations tab beside Users to review pending invitations. Select View on a pending invitation to cancel it when access is no longer needed.', navigation: { group: 'People', label: 'Users' } },
            { page: 'departments.html', target: '#sectionAction', title: 'Set up departments', body: 'Create departments before assigning employees to them. Edit a department to add employees and optionally apply one schedule to those selected employees.', navigation: { group: 'People', label: 'Departments' } },
            { page: 'projects.html', target: '#sectionAction', title: 'Set up projects', body: 'Create projects employees can select while tracking time. Edit a project to add employees directly and optionally apply one schedule to those selected employees.', navigation: { group: 'Work', label: 'Projects' } },
            { page: 'schedule-flex.html', target: '#scheduleForm', title: 'Create schedules and flextime', body: 'Set the schedule name, fixed or flex type, workdays and expected hours. At least one working day is required.', navigation: { group: 'Work', label: 'Schedule & flextime' } },
            { page: 'schedule-flex.html', target: '#assignmentForm', title: 'Assign a schedule', body: 'After creating a schedule, choose an active employee and assign it here. This connects the employee to the working-day rules.' },
            { page: 'admin-time-entries.html', target: '#sectionSearch', title: 'Review and export time entries', body: 'Search entries, use filters, and use Export entries to choose a date range and save a PDF or Excel workbook. Use the page controls to move through large result lists.', navigation: { group: 'Work', label: 'Time entries' } },
            { page: 'admin-time-entries.html', target: '#sectionTableBody', title: 'Correct, approve overtime, or remove safely', body: 'For an entry, use Correct time only for a genuine missed or incorrect clock-in or clock-out. Fixed schedules can show Approved overtime after an administrator approves time beyond the scheduled end. Add internal remarks when context matters; Move to deleted keeps a completed entry out of normal reporting.' },
            { page: 'admin-time-entries.html', target: '#sectionSearch', title: 'Restore deleted time entries', body: 'Choose Deleted entries beside Export entries to open the recovery list. Deleted entries are excluded from normal dashboards and reports; restore one only when it was removed by mistake.', navigation: { group: 'Work', label: 'Time entries' } },
            { page: 'deleted-users.html', target: '#deletedUsersTable', title: 'Restore archived users', body: 'Archived people cannot sign in, but their company history is retained. Restore access here when an account should be active again.', navigation: { group: 'People', label: 'Archived users' } },
            { page: 'reports.html', target: '#reportsList', title: 'Open generated reports', body: 'This is the saved-report archive. Open a report to preview it, save it as PDF or Excel, or delete an obsolete report. Create employee reports from Individual reports.', navigation: { group: 'Insights', label: 'Reports' } },
            { page: 'individual-reports.html', target: '#individualReportForm', title: 'Prepare individual reports', body: 'Choose a custom start and end date, then optionally one employee. Leave the employee blank to prepare a separate report for every active employee.', navigation: { group: 'Insights', label: 'Individual reports' } },
            { page: 'audit-logs.html', target: '#sectionSearch', title: 'Review the audit log', body: 'Search the read-only history of important actions, such as approvals, account changes, time corrections, and report exports.', navigation: { group: 'Administration', label: 'Audit log' } },
            { page: 'settings.html', target: '#profileSettings', title: 'Update your administrator profile', body: 'Keep your own display name and photo current. This affects how your name appears across administrative records.', navigation: { group: 'Administration', label: 'Settings' } },
            { page: 'settings.html', target: '#securityTab', title: 'Review account security', body: 'Open Security to see the sign-in and account-protection options available for your administrator account.' },
            { page: 'settings.html', target: '#appearanceTab', title: 'Choose display preferences', body: 'Open Appearance to adjust display preferences such as text size and compact mode for your own workspace.' }
        ]
    }
};
