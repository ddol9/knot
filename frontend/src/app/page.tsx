export default function Page() {
  return (
    <div className="h-[calc(100vh-3.5rem)] bg-[#fffdf8]">
      <iframe
        src={`${process.env.NEXT_PUBLIC_KNOT_BASE_PATH ?? ""}/knot/index.html`}
        title="knot — 크리에이터와 브랜드를 잇는 매듭"
        className="h-full w-full border-0 bg-[#fffdf8]"
      />
    </div>
  );
}
