import { redirect } from "next/navigation";

/** The app always lands on the "start a new chat" screen — see /chat. */
export default function Home() {
  redirect("/chat");
}
