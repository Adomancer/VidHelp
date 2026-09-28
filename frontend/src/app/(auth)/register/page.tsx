import Link from "next/link";
import GoogleButton from "@/components/GoogleButton";

export default function RegisterPage() {
  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 shadow-2xl">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">VidHelp</h1>
        <p className="text-sm text-gray-300 mt-2">Create your account</p>
      </div>

      <GoogleButton label="Sign up with Google" />

      <p className="text-center text-xs text-gray-400">
        New accounts are reviewed by an admin before you can sign in.
      </p>

      <p className="text-center text-sm text-gray-400">
        Already have an account?{" "}
        <Link href="/login" className="text-purple-300 hover:text-white">
          Sign in
        </Link>
      </p>
    </div>
  );
}
