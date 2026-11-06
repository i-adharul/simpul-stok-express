// A titled placeholder box for a block whose data arrives in a later story (S06 and S08 skeletons).
export default function ComingSoonSection({ title, message }) {
  return (
    <section className="rounded-xl border border-dashed border-base-300 bg-base-100 p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-base-content/60">{message}</p>
    </section>
  )
}
