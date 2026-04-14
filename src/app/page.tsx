import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth";

export default async function HomePage() {
  const userId = await getCurrentUserId();

  if (userId) {
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}
