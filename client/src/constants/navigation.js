// Sidebar menu. `roles` lists who sees an item; no `roles` means every tenant role.
// Role names are the data values (see docs/02_Functional_Spec.md, "Menus and redirects").
export const NAV_GROUPS = [
  {
    title: 'Menu Utama',
    items: [{ label: 'Dashboard', to: '/dashboard', icon: 'dashboard' }],
  },
  {
    title: 'Inventori',
    items: [
      { label: 'Ringkasan Stok', to: '/stock', icon: 'analytics' },
      { label: 'Produk', to: '/products', icon: 'category' },
      { label: 'Gudang', to: '/warehouses', icon: 'warehouse' },
      { label: 'Mutasi', to: '/transfers/new', icon: 'sync_alt', roles: ['OWNER', 'WAREHOUSE_ADMIN'] },
      { label: 'Riwayat', to: '/movements', icon: 'receipt_long' },
    ],
  },
  {
    title: 'Administrasi',
    roles: ['OWNER'],
    items: [
      { label: 'Anggota', to: '/members', icon: 'group' },
      { label: 'Pengaturan', to: '/settings', icon: 'settings' },
      { label: 'Langganan', to: '/billing', icon: 'card_membership' },
      { label: 'Audit Log', to: '/audit', icon: 'history' },
    ],
  },
]

export const ROLE_LABELS = {
  OWNER: 'Owner',
  WAREHOUSE_ADMIN: 'Admin Gudang',
  VIEWER: 'Viewer',
}

// Pure function so it is easy to reason about: which groups and items does this role see?
export function visibleNav(role) {
  const allowed = (entry) => !entry.roles || entry.roles.includes(role)
  return NAV_GROUPS.filter(allowed)
    .map((group) => ({ ...group, items: group.items.filter(allowed) }))
    .filter((group) => group.items.length > 0)
}
