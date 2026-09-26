<?php

use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\GoogleAuthController;
use App\Http\Controllers\Admin\DashboardController as AdminDashboardController;
use App\Http\Controllers\Admin\UserManagementController;
use App\Http\Controllers\Admin\FinanceController;
use App\Http\Controllers\Operator\DashboardController as OperatorDashboardController;
use App\Http\Controllers\Operator\ScheduleController;
use App\Http\Controllers\Operator\BackupHostController;
use App\Http\Controllers\Operator\HostRatingController;
use App\Http\Controllers\Host\MyScheduleController;
use App\Http\Controllers\Host\ProfileController;
use App\Http\Controllers\Host\MyRatingController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Auth Routes (Public)
|--------------------------------------------------------------------------
*/
Route::prefix('auth')->group(function () {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);

    // Google OAuth
    Route::get('/google/redirect', [GoogleAuthController::class, 'redirect']);
    Route::get('/google/callback', [GoogleAuthController::class, 'callback']);
});

/*
|--------------------------------------------------------------------------
| Protected Routes (Require Auth)
|--------------------------------------------------------------------------
*/
Route::middleware('auth:sanctum')->group(function () {

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

        // Schedule Management
        Route::apiResource('/schedules', ScheduleController::class);

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
        Route::get('/schedules/{id}', [MyScheduleController::class, 'show']);

        // My Profile
        Route::get('/profile', [ProfileController::class, 'show']);
        Route::put('/profile', [ProfileController::class, 'update']);
        Route::post('/profile/password', [ProfileController::class, 'changePassword']);

        // My Ratings (read-only)
        Route::get('/ratings', [MyRatingController::class, 'index']);
    });
});
