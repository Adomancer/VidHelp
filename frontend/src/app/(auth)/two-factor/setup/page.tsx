"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import { RequireAuth, useAuth } from "@/components/AuthProvider";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import { hasAnyRole, homePathFor } from "@/lib/auth";

/** Admins and finance land here after sign-in until they have set up 2FA. */
export default function TwoFactorSetupPage() {
  return (
    <RequireAuth roles={["admin", "finance"]} allowTwoFactorSetup>
      <AuthCard subtitle="Amankan akun kamu">
        <RequiredSetup />
      </AuthCard>
    </RequireAuth>
  );
}

function RequiredSetup() {
  const { user, logout } = useAuth();
  const router = useRouter();
  // Read once on arrival: finishing setup flips the flag, and the recovery codes must still show
  const [alreadyOn] = useState(user.two_factor_enabled);

  // Opened by hand after 2FA is already on: nothing to do here
  useEffect(() => {
    if (alreadyOn) router.replace(hasAnyRole(user, ["admin"]) ? "/admin/security" : "/finance/security");
  }, [alreadyOn, router, user]);

  if (alreadyOn) return null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-body text-center">
        Akun admin dan finance mengelola data pribadi dan pembayaran, jadi wajib verifikasi dua langkah: setelah kata sandi atau
        Google, kamu juga memasukkan kode dari aplikasi di HP.
      </p>
      <TwoFactorSetup onDone={(updated) => router.replace(homePathFor(updated))} />
      <button type="button" onClick={logout} className="w-full text-sm text-muted hover:text-heading">
        Keluar
      </button>
    </div>
  );
}
