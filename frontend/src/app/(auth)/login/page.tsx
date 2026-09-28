import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <GuestOnly>
      <AuthCard subtitle="Agency Management Platform">
        <LoginForm />

        <p className="text-center text-sm text-gray-400">
          New host?{" "}
          <Link href="/register" className="text-purple-300 hover:text-white">
            Create an account
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
