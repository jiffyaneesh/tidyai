import { ViewTransition, type CSSProperties, type ReactNode } from "react";
import { useLocation } from "react-router";

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}

function StudyNote() {
  return (
    <figure className="auth-note w-[min(340px,100%)] rounded-2xl p-5 text-[#17151f]">
      <p className="note-line font-mono text-[0.625rem] font-medium uppercase tracking-[0.14em] text-[#17151f]/70" style={{ "--i": 0 } as CSSProperties}>
        Mechanics · session 4
      </p>
      <p className="note-line mt-3 rounded-xl bg-white/70 px-3 py-2 text-[0.8125rem] leading-snug" style={{ "--i": 1 } as CSSProperties}>
        Why does a longer wrench loosen a bolt more easily?
      </p>
      <div className="mt-4 border-t border-[#17151f]/10 pt-4">
        <p className="note-line font-serif text-[1.375rem] leading-none tracking-[-0.03em]" style={{ "--i": 2 } as CSSProperties}>
          Torque
        </p>
        <ul className="mt-2.5 space-y-1.5 text-[0.8125rem] leading-snug">
          <li className="note-line flex gap-2" style={{ "--i": 3 } as CSSProperties}>
            <span aria-hidden className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-[#7e56cf]" />
            <span>
              <span className="font-mono text-[0.75rem]">τ = r × F</span>, the turning effect of a force.
            </span>
          </li>
          <li className="note-line flex gap-2" style={{ "--i": 4 } as CSSProperties}>
            <span aria-hidden className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-[#7e56cf]" />
            <span>Same force, longer lever arm, more torque.</span>
          </li>
        </ul>
      </div>
    </figure>
  );
}

function ArtPanel() {
  return (
    <aside
      aria-hidden
      className="auth-art relative m-3 h-36 shrink-0 overflow-hidden rounded-[24px] min-[960px]:sticky min-[960px]:top-3 min-[960px]:h-[calc(100dvh-1.5rem)] min-[960px]:rounded-[28px]"
    >
      <img src="/art/orb.webp" alt="" className="auth-art-img absolute inset-0 size-full object-cover object-[30%_50%]" />
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-6 text-[#17151f] min-[960px]:p-9">
        <span className="size-2 rounded-full bg-[#17151f]" />
        <span className="text-[0.9375rem] font-bold tracking-[-0.03em]">tidyai</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 hidden flex-col gap-8 p-9 min-[960px]:flex">
        <StudyNote />
        <p className="max-w-[16ch] font-serif text-[clamp(2.25rem,3.4vw,3.25rem)] leading-[1.02] tracking-[-0.035em] text-[#17151f]">
          Every answer leaves a <em className="italic">note.</em>
        </p>
      </div>
      <p className="absolute bottom-3 right-4 hidden font-mono text-[0.5625rem] tracking-[0.08em] text-[#17151f]/70 min-[960px]:block">
        Art · Logan Voss / Unsplash
      </p>
    </aside>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="flex min-h-full flex-col min-[960px]:grid min-[960px]:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
        <ArtPanel />
        <main className="flex flex-1 flex-col px-6 pb-8 pt-6 sm:px-12 min-[960px]:px-16 min-[960px]:py-10">
          <ViewTransition key={location.pathname} enter="form-in" exit="form-out" default="none">
            <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-6">{children}</div>
          </ViewTransition>
          <footer className="mx-auto w-full max-w-[380px] pt-6 text-[0.6875rem] text-muted-foreground">
            Your provider key stays in this browser. tidyai never stores it.
          </footer>
        </main>
      </div>
    </div>
  );
}
