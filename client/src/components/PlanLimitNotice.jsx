// The notice for 403 PLAN_LIMIT_REACHED (BL20). `message` is the server text, already Indonesian and with the
// numbers ("Batas gudang pada paket Anda sudah tercapai (2 dari 2)."). Shown in the popups of P01, P02, P07 and in S03.
export default function PlanLimitNotice({ message }) {
  return (
    <div role="alert" className="alert alert-warning alert-soft items-start text-sm">
      <span className="material-symbols-outlined text-[20px]">workspace_premium</span>
      <div className="space-y-0.5">
        <p className="font-semibold">{message}</p>
        <p>Arsipkan data yang tidak dipakai, atau pilih paket yang lebih besar di menu Langganan.</p>
      </div>
    </div>
  )
}
