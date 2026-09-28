import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <GuestOnly>
      <AuthCard subtitle="Create your account">
        <RegisterForm />

        <p className="text-center text-xs text-gray-400">
          New accounts are reviewed by an admin before you can sign in.
        </p>
        <p className="text-center text-sm text-gray-400">
          Already have an account?{" "}
          <Link href="/login" className="text-purple-300 hover:text-white">
            Sign in
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
