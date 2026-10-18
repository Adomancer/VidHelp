<?php

use App\Http\Controllers\Admin\AuditLogController;
use App\Http\Controllers\Admin\BrandController;
use App\Http\Controllers\Admin\DashboardController as AdminDashboardController;
use App\Http\Controllers\Admin\HostController as AdminHostController;
use App\Http\Controllers\Admin\NotificationDeliveryController;
use App\Http\Controllers\Admin\PointAdminController;
use App\Http\Controllers\Admin\ProfileChangeController;
use App\Http\Controllers\Admin\RateCategoryController;
use App\Http\Controllers\Admin\RatingController;
use App\Http\Controllers\Admin\SettingsController as AdminSettingsController;
use App\Http\Controllers\Admin\UserManagementController;
use App\Http\Controllers\Admin\ViolationTypeController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\GoogleAuthController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\DiscordController;
use App\Http\Controllers\DiscordInteractionController;
use App\Http\Controllers\Finance\CashAdvanceController;
use App\Http\Controllers\Finance\PayrollController;
use App\Http\Controllers\Host\AvailabilityController;
use App\Http\Controllers\Host\BackupController as HostBackupController;
use App\Http\Controllers\Host\BrandController as HostBrandController;
use App\Http\Controllers\Host\DashboardController as HostDashboardController;
use App\Http\Controllers\Host\EventController as HostEventController;
use App\Http\Controllers\Host\LiveController;
use App\Http\Controllers\Host\MyScheduleController;
use App\Http\Controllers\Host\PayController;
use App\Http\Controllers\Host\PerformanceController;
use App\Http\Controllers\Host\ProfileController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\Operator\AssignmentController;
use App\Http\Controllers\Operator\BackupController as OperatorBackupController;
use App\Http\Controllers\Operator\BrandKnowledgeController;
use App\Http\Controllers\Operator\DashboardController as OperatorDashboardController;
use App\Http\Controllers\Operator\EventController as OperatorEventController;
use App\Http\Controllers\Operator\HostController as OperatorHostController;
use App\Http\Controllers\Operator\PointController;
use App\Http\Controllers\Operator\ReportController;
use App\Http\Controllers\Operator\ScheduleController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\TwoFactorController;
use App\Http\Middleware\VerifyDiscordSignature;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Auth Routes (Public)
|--------------------------------------------------------------------------
*/
Route::prefix('auth')->middleware('throttle:10,1')->group(function () {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/two-factor-challenge', [AuthController::class, 'twoFactorChallenge']);

    // Password reset (link in the email opens the frontend /reset-password page)
    Route::post('/forgot-password', [PasswordResetController::class, 'sendLink']);
    Route::post('/reset-password', [PasswordResetController::class, 'reset']);

    // Google OAuth
    Route::get('/google/redirect', [GoogleAuthController::class, 'redirect']);
    Route::get('/google/callback', [GoogleAuthController::class, 'callback']);
});

// Slash commands from Discord (signed by Discord instead of a user token)
Route::post('/discord/interactions', DiscordInteractionController::class)->middleware(VerifyDiscordSignature::class);

/*
|--------------------------------------------------------------------------
| Protected Routes (Require Auth)
|--------------------------------------------------------------------------
*/
Route::middleware(['auth:sanctum', 'active'])->group(function () {
    // Shared auth routes
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    // My two-factor authentication (admins and finance). Reachable before 2FA is set up.
    Route::prefix('two-factor')->middleware(['role:admin|finance', 'throttle:20,1'])->group(function () {
        Route::get('/', [TwoFactorController::class, 'show']);
        Route::post('/setup', [TwoFactorController::class, 'setup']);
        Route::post('/confirm', [TwoFactorController::class, 'confirm']);
        Route::post('/recovery-codes', [TwoFactorController::class, 'regenerateRecoveryCodes']);
        Route::delete('/', [TwoFactorController::class, 'destroy']);
    });
});

// Everything else: admins must have 2FA set up first (while it's required)
Route::middleware(['auth:sanctum', 'active', 'two_factor'])->group(function () {

    // In-app notifications (the bell) and Discord linking, for every role
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::get('/notifications/unread-count', [NotificationController::class, 'unreadCount']);
    Route::post('/notifications/read-all', [NotificationController::class, 'readAll']);
    Route::post('/notifications/{notification}/read', [NotificationController::class, 'read']);
    Route::get('/discord', [DiscordController::class, 'show']);
    Route::get('/discord/connect-url', [DiscordController::class, 'connectUrl']);
    Route::post('/discord/link', [DiscordController::class, 'link']);
    Route::delete('/discord/link', [DiscordController::class, 'unlink']);
    Route::post('/discord/test', [DiscordController::class, 'test']);
    Route::put('/discord/preferences', [DiscordController::class, 'preferences']);

    // Rule numbers shown in help texts
    Route::get('/settings', [SettingsController::class, 'index']);

    /*
    |----------------------------------------------------------------------
    | Admin Routes (finance has every admin right too)
    |----------------------------------------------------------------------
    */
    Route::prefix('admin')->middleware('role:admin|finance')->group(function () {
        Route::get('/dashboard', [AdminDashboardController::class, 'index']);

        // User Management: create, approve, deactivate (temporary), archive (resigned), delete permanently
        Route::get('/users', [UserManagementController::class, 'index']);
        Route::post('/users', [UserManagementController::class, 'store']);
        Route::get('/users/{user}', [UserManagementController::class, 'show']);
        Route::put('/users/{user}', [UserManagementController::class, 'update']);
        Route::post('/users/{user}/deactivate', [UserManagementController::class, 'deactivate']);
        Route::post('/users/{user}/activate', [UserManagementController::class, 'activate']);
        Route::post('/users/{user}/archive', [UserManagementController::class, 'archive']);
        Route::post('/users/{user}/erase', [UserManagementController::class, 'erase']);
        Route::post('/users/{user}/two-factor/reset', [UserManagementController::class, 'resetTwoFactor']);

        // Audit trail
        Route::get('/audit-logs', [AuditLogController::class, 'index']);

        // Discord: setup check, every message with its status, resend, test posts
        Route::get('/notifications/discord', [NotificationDeliveryController::class, 'status']);
        Route::get('/notifications/deliveries', [NotificationDeliveryController::class, 'index']);
        Route::post('/notifications/deliveries/{notification}/resend', [NotificationDeliveryController::class, 'resend']);
        Route::post('/notifications/test-channel', [NotificationDeliveryController::class, 'testChannel']);
        Route::post('/notifications/preview', [NotificationDeliveryController::class, 'preview']);

        // Business rules (overrides of config/vidhelp.php)
        Route::get('/settings', [AdminSettingsController::class, 'index']);
        Route::put('/settings', [AdminSettingsController::class, 'update']);

        // Brands (create/edit; listing is in the operator group)
        Route::post('/brands', [BrandController::class, 'store']);
        Route::put('/brands/{brand}', [BrandController::class, 'update']);

        // Rate levels (magang, baru, ...)
        Route::get('/rate-categories', [RateCategoryController::class, 'index']);
        Route::post('/rate-categories', [RateCategoryController::class, 'store']);
        Route::put('/rate-categories/{rateCategory}', [RateCategoryController::class, 'update']);
        Route::delete('/rate-categories/{rateCategory}', [RateCategoryController::class, 'destroy']);

        // Hosts' personal data changes, waiting for approval
        Route::get('/profile-changes', [ProfileChangeController::class, 'index']);
        Route::post('/profile-changes/{change}/approve', [ProfileChangeController::class, 'approve']);
        Route::post('/profile-changes/{change}/reject', [ProfileChangeController::class, 'reject']);

        // Host details incl. KTP & bank (admin only)
        Route::get('/hosts/{host}', [AdminHostController::class, 'show']);
        Route::put('/hosts/{host}', [AdminHostController::class, 'update']);

        // Lock/unlock schedule slots
        Route::put('/schedules/{schedule}/lock', [ScheduleController::class, 'lock']);

        // Points & SP corrections, violation types, monthly ratings
        Route::post('/points/logs/{log}/void', [PointAdminController::class, 'voidLog']);
        Route::post('/warning-letters', [PointAdminController::class, 'issueWarning']);
        Route::post('/warning-letters/{letter}/void', [PointAdminController::class, 'voidWarning']);
        Route::get('/violation-types', [ViolationTypeController::class, 'index']);
        Route::post('/violation-types', [ViolationTypeController::class, 'store']);
        Route::put('/violation-types/{violationType}', [ViolationTypeController::class, 'update']);
        Route::get('/ratings', [RatingController::class, 'index']);
        Route::get('/ratings/export', [RatingController::class, 'export']);
        Route::get('/ratings/hosts/{host}', [RatingController::class, 'show']);
        Route::get('/ratings/hosts/{host}/history', [RatingController::class, 'history']);
        Route::put('/ratings', [RatingController::class, 'upsert']);
        Route::post('/ratings/apply-suggested', [RatingController::class, 'applySuggested']);
    });

    /*
    |----------------------------------------------------------------------
    | Finance Routes (payroll and kasbon): admins may look, only finance may change
    |----------------------------------------------------------------------
    */
    Route::prefix('finance')->middleware('role:finance|admin')->group(function () {
        Route::get('/brands', [PayrollController::class, 'brands']);
        Route::get('/hosts', [PayrollController::class, 'hosts']);

        // Payroll: periods per brand, salary slips
        Route::get('/payroll/summary', [PayrollController::class, 'summary']);
        Route::get('/payroll/periods', [PayrollController::class, 'periods']);
        Route::get('/payroll/periods/{period}', [PayrollController::class, 'show']);
        Route::get('/payroll/periods/{period}/export', [PayrollController::class, 'export']);
        Route::get('/payroll/report', [PayrollController::class, 'report']);
        Route::get('/payroll/slips/{slip}', [PayrollController::class, 'slip']);

        // Kasbon (cash advances)
        Route::get('/cash-advances', [CashAdvanceController::class, 'index']);
        Route::get('/cash-advances/limit/{host}', [CashAdvanceController::class, 'limit']);

        Route::middleware('role:finance')->group(function () {
            // Adjustments, closing a period early, payment requests (on the PIC's behalf), marking paid
            Route::post('/payroll/periods/{period}/adjustments', [PayrollController::class, 'storeAdjustment']);
            Route::delete('/payroll/adjustments/{adjustment}', [PayrollController::class, 'destroyAdjustment']);
            Route::post('/payroll/periods/{period}/close', [PayrollController::class, 'close']);
            Route::post('/payroll/periods/{period}/request', [PayrollController::class, 'requestPayment']);
            Route::post('/payroll/periods/{period}/cancel-request', [PayrollController::class, 'cancelRequest']);
            Route::post('/payroll/periods/{period}/paid', [PayrollController::class, 'markPaid']);

            Route::post('/cash-advances', [CashAdvanceController::class, 'store']);
            Route::post('/cash-advances/{advance}/settle', [CashAdvanceController::class, 'settle']);
            Route::post('/cash-advances/{advance}/reschedule', [CashAdvanceController::class, 'reschedule']);
            Route::delete('/cash-advances/{advance}', [CashAdvanceController::class, 'destroy']);
        });
    });

    /*
    |----------------------------------------------------------------------
    | Operator Routes
    |----------------------------------------------------------------------
    */
    Route::prefix('operator')->middleware('role:operator|admin|finance')->group(function () {
        Route::get('/dashboard', [OperatorDashboardController::class, 'index']);

        // Hosts & brand assignments
        Route::get('/hosts', [OperatorHostController::class, 'index']);
        Route::get('/hosts/export', [OperatorHostController::class, 'export']);
        Route::get('/brands', [BrandController::class, 'index']);
        Route::get('/brands/{brand}/hosts', [BrandController::class, 'hosts']);

        // Product knowledge: the text pasted from WA plus the files the brand sent
        Route::get('/brands/{brand}/knowledge', [BrandKnowledgeController::class, 'show']);
        Route::put('/brands/{brand}/knowledge', [BrandKnowledgeController::class, 'update']);
        Route::post('/brands/{brand}/knowledge/files', [BrandKnowledgeController::class, 'upload']);
        Route::get('/brands/{brand}/knowledge/files/{attachment}', [BrandKnowledgeController::class, 'file']);
        Route::delete('/brands/{brand}/knowledge/files/{attachment}', [BrandKnowledgeController::class, 'destroy']);
        Route::post('/assignments', [AssignmentController::class, 'store']);
        Route::put('/assignments/{assignment}', [AssignmentController::class, 'update']);

        // Schedule Management
        Route::get('/schedules/conflicts', [ScheduleController::class, 'conflicts']);
        Route::get('/schedules/{schedule}/history', [ScheduleController::class, 'history']);
        Route::post('/schedules/{schedule}/undo', [ScheduleController::class, 'undo']);
        Route::apiResource('/schedules', ScheduleController::class)->except('show');

        // Backups: approve or reject applicants, assign a cover directly in emergencies
        Route::get('/backups', [OperatorBackupController::class, 'index']);
        Route::post('/backups', [OperatorBackupController::class, 'store']);
        Route::get('/backups/candidates', [OperatorBackupController::class, 'slotCandidates']);
        Route::get('/backups/{backup}/applicants', [OperatorBackupController::class, 'applicants']);
        Route::get('/backups/{backup}/candidates', [OperatorBackupController::class, 'candidates']);
        Route::get('/backups/{backup}/letter', [OperatorBackupController::class, 'letter']);
        Route::post('/backups/{backup}/reject-applicant', [OperatorBackupController::class, 'rejectApplicant']);
        Route::post('/backups/{backup}/cancel', [OperatorBackupController::class, 'cancel']);
        Route::post('/backups/{backup}/assign', [OperatorBackupController::class, 'assign']);
        Route::post('/backups/{backup}/unassign', [OperatorBackupController::class, 'unassign']);

        // Live reports: review flagged ones, see overdue ones
        Route::get('/reports', [ReportController::class, 'index']);
        Route::post('/reports/{report}/approve', [ReportController::class, 'approve']);
        Route::post('/reports/{report}/reject', [ReportController::class, 'reject']);

        // Special events (PD, double date): blocks hosts claim
        Route::get('/events', [OperatorEventController::class, 'index']);
        Route::post('/events', [OperatorEventController::class, 'store']);
        Route::get('/events/{event}', [OperatorEventController::class, 'show']);
        Route::put('/events/{event}', [OperatorEventController::class, 'update']);
        Route::delete('/events/{event}', [OperatorEventController::class, 'destroy']);
        Route::post('/events/{event}/assign', [OperatorEventController::class, 'assign']);
        Route::post('/event-claims/{claim}/release', [OperatorEventController::class, 'release']);

        // Points: record violations and brand complaints
        Route::get('/points', [PointController::class, 'index']);
        Route::get('/points/export', [PointController::class, 'export']);
        Route::get('/points/hosts/{host}', [PointController::class, 'show']);
        Route::get('/violation-types', [PointController::class, 'violationTypes']);
        Route::post('/points/violations', [PointController::class, 'storeViolation']);
        Route::post('/points/complaints', [PointController::class, 'storeComplaint']);
    });

    /*
    |----------------------------------------------------------------------
    | Host Routes
    |----------------------------------------------------------------------
    */
    Route::prefix('host')->middleware('role:host|operator|admin|finance')->group(function () {
        // My overview: next session, to-dos, pay and score
        Route::get('/dashboard', [HostDashboardController::class, 'index']);

        // My Schedule (read-only)
        Route::get('/schedules', [MyScheduleController::class, 'index']);
        Route::get('/availability', [AvailabilityController::class, 'show']);
        Route::put('/availability', [AvailabilityController::class, 'update']);

        // Product knowledge of the brands I'm assigned to
        Route::get('/brands', [HostBrandController::class, 'index']);
        Route::get('/brands/{brand}', [HostBrandController::class, 'show']);
        Route::get('/brands/{brand}/files/{attachment}', [HostBrandController::class, 'file']);

        // Backups: request cover for my slot (open or to named hosts), apply to cover others
        Route::get('/backups', [HostBackupController::class, 'index']);
        Route::get('/backups/needs', [HostBackupController::class, 'needs']);
        Route::get('/backups/slots', [HostBackupController::class, 'slots']);
        Route::get('/backups/candidates', [HostBackupController::class, 'candidates']);
        Route::post('/backups', [HostBackupController::class, 'store']);
        Route::post('/backups/{backup}/cancel', [HostBackupController::class, 'cancel']);
        Route::post('/backups/{backup}/letter', [HostBackupController::class, 'uploadLetter']);
        Route::post('/backups/{backup}/apply', [HostBackupController::class, 'apply']);
        Route::post('/backups/{backup}/withdraw', [HostBackupController::class, 'withdraw']);
        Route::post('/backups/{backup}/drop', [HostBackupController::class, 'drop']);

        // Special events: claim blocks
        Route::get('/events', [HostEventController::class, 'index']);
        Route::post('/events/{event}/claim', [HostEventController::class, 'claim']);
        Route::post('/event-claims/{claim}/cancel', [HostEventController::class, 'cancel']);

        // Live: check in/out and send the live report
        Route::get('/live', [LiveController::class, 'index']);
        Route::post('/live/check-in', [LiveController::class, 'checkIn']);
        Route::post('/live/{attendance}/check-out', [LiveController::class, 'checkOut']);
        Route::post('/live/{attendance}/report', [LiveController::class, 'report']);

        // My Profile
        Route::get('/profile', [ProfileController::class, 'show']);
        Route::put('/profile', [ProfileController::class, 'update']);
        Route::post('/profile/password', [ProfileController::class, 'changePassword']);
        Route::post('/profile/photo', [ProfileController::class, 'updatePhoto']);
        Route::put('/profile/sensitive', [ProfileController::class, 'updateSensitive']);
        Route::post('/profile/changes/{change}/cancel', [ProfileController::class, 'cancelChange']);

        // My points, SPs and ratings (read-only)
        Route::get('/performance', [PerformanceController::class, 'index']);

        // My pay: open periods, salary slips, kasbon
        Route::get('/pay', [PayController::class, 'index']);
        Route::get('/pay/slips/{slip}', [PayController::class, 'slip']);
        // As a brand's leader (PIC): its periods, request payment once the target is reached, the brand report
        Route::post('/pay/periods/{period}/request', [PayController::class, 'requestPayment']);
        Route::get('/pay/periods/{period}/export', [PayController::class, 'export']);
    });
});
