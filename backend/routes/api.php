<?php

use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\GoogleAuthController;
use App\Http\Controllers\Auth\PasswordResetController;
use App\Http\Controllers\Admin\DashboardController as AdminDashboardController;
use App\Http\Controllers\Admin\UserManagementController;
use App\Http\Controllers\Admin\FinanceController;
use App\Http\Controllers\Admin\BrandController;
use App\Http\Controllers\Admin\HostController as AdminHostController;
use App\Http\Controllers\Admin\RateCategoryController;
use App\Http\Controllers\Operator\DashboardController as OperatorDashboardController;
use App\Http\Controllers\Operator\ScheduleController;
use App\Http\Controllers\Operator\BackupHostController;
use App\Http\Controllers\Operator\HostRatingController;
use App\Http\Controllers\Operator\HostController as OperatorHostController;
use App\Http\Controllers\Operator\AssignmentController;
use App\Http\Controllers\Host\MyScheduleController;
use App\Http\Controllers\Host\ProfileController;
use App\Http\Controllers\Host\MyRatingController;
use App\Http\Controllers\Host\AvailabilityController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Auth Routes (Public)
|--------------------------------------------------------------------------
*/
Route::prefix('auth')->middleware('throttle:10,1')->group(function () {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);

    // Password reset (link in the email opens the frontend /reset-password page)
    Route::post('/forgot-password', [PasswordResetController::class, 'sendLink']);
    Route::post('/reset-password', [PasswordResetController::class, 'reset']);

    // Google OAuth
    Route::get('/google/redirect', [GoogleAuthController::class, 'redirect']);
    Route::get('/google/callback', [GoogleAuthController::class, 'callback']);
});

/*
|--------------------------------------------------------------------------
| Protected Routes (Require Auth)
|--------------------------------------------------------------------------
*/
Route::middleware(['auth:sanctum', 'active'])->group(function () {

    // Shared auth routes
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);

    /*
    |----------------------------------------------------------------------
    | Admin Routes
    |----------------------------------------------------------------------
    */
    Route::prefix('admin')->middleware('role:admin')->group(function () {
        Route::get('/dashboard', [AdminDashboardController::class, 'index']);

        // User Management
        Route::get('/users', [UserManagementController::class, 'index']);
        Route::get('/users/{user}', [UserManagementController::class, 'show']);
        Route::put('/users/{user}', [UserManagementController::class, 'update']);
        Route::post('/users/{user}/deactivate', [UserManagementController::class, 'deactivate']);
        Route::post('/users/{user}/activate', [UserManagementController::class, 'activate']);

        // Brands (create/edit; listing is in the operator group)
        Route::post('/brands', [BrandController::class, 'store']);
        Route::put('/brands/{brand}', [BrandController::class, 'update']);

        // Rate levels (magang, baru, ...)
        Route::get('/rate-categories', [RateCategoryController::class, 'index']);
        Route::post('/rate-categories', [RateCategoryController::class, 'store']);
        Route::put('/rate-categories/{rateCategory}', [RateCategoryController::class, 'update']);
        Route::delete('/rate-categories/{rateCategory}', [RateCategoryController::class, 'destroy']);

        // Host details incl. KTP & bank (admin only)
        Route::get('/hosts/{host}', [AdminHostController::class, 'show']);
        Route::put('/hosts/{host}', [AdminHostController::class, 'update']);
        Route::get('/hosts/{host}/ktp-image', [AdminHostController::class, 'ktpImage']);

        // Lock/unlock schedule slots
        Route::put('/schedules/{schedule}/lock', [ScheduleController::class, 'lock']);

        // Finance (Admin Only)
        Route::get('/finance', [FinanceController::class, 'index']);
        Route::get('/finance/payroll', [FinanceController::class, 'payroll']);
    });

    /*
    |----------------------------------------------------------------------
    | Operator Routes
    |----------------------------------------------------------------------
    */
    Route::prefix('operator')->middleware('role:operator|admin')->group(function () {
        Route::get('/dashboard', [OperatorDashboardController::class, 'index']);

        // Hosts & brand assignments
        Route::get('/hosts', [OperatorHostController::class, 'index']);
        Route::get('/brands', [BrandController::class, 'index']);
        Route::get('/brands/{brand}/hosts', [BrandController::class, 'hosts']);
        Route::post('/assignments', [AssignmentController::class, 'store']);
        Route::put('/assignments/{assignment}', [AssignmentController::class, 'update']);

        // Schedule Management
        Route::apiResource('/schedules', ScheduleController::class)->except('show');

        // Backup Host Management
        Route::get('/backup-hosts', [BackupHostController::class, 'index']);
        Route::post('/backup-hosts/assign', [BackupHostController::class, 'assign']);

        // Host Rating
        Route::get('/ratings', [HostRatingController::class, 'index']);
        Route::post('/ratings', [HostRatingController::class, 'store']);
        Route::put('/ratings/{id}', [HostRatingController::class, 'update']);
    });

    /*
    |----------------------------------------------------------------------
    | Host Routes
    |----------------------------------------------------------------------
    */
    Route::prefix('host')->middleware('role:host|operator|admin')->group(function () {
        // My Schedule (read-only)
        Route::get('/schedules', [MyScheduleController::class, 'index']);
        Route::get('/availability', [AvailabilityController::class, 'show']);
        Route::put('/availability', [AvailabilityController::class, 'update']);

        // My Profile
        Route::get('/profile', [ProfileController::class, 'show']);
        Route::put('/profile', [ProfileController::class, 'update']);
        Route::post('/profile/password', [ProfileController::class, 'changePassword']);
        Route::post('/profile/photo', [ProfileController::class, 'updatePhoto']);
        Route::put('/profile/sensitive', [ProfileController::class, 'updateSensitive']);
        Route::post('/profile/ktp-image', [ProfileController::class, 'uploadKtpImage']);

        // My Ratings (read-only)
        Route::get('/ratings', [MyRatingController::class, 'index']);
    });
});
