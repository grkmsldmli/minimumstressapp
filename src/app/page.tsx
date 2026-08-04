import { App } from "@/components/app";
import { AppStateProvider } from "@/components/app-state";

export default function Home() {
  return (
    <main className="w-full flex items-center justify-center py-8">
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: 385,
          height: 780,
          borderRadius: 44,
          border: "9px solid #16304E",
          boxShadow: "0 40px 90px -30px rgba(22,48,78,0.45)",
        }}
      >
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </div>
    </main>
  );
}
