import { useMemo, useState } from 'react'
import type { Account, AccountGroup, Transaction } from '../types'
import { ACCOUNT_GROUPS } from '../types'
import { useStore } from '../store'
import { accountBalance, accountsByGroup, assetsLiabilities, profitOf, totalsOf, txsInMonth } from '../lib/calc'
import { formatAmount, toPaise } from '../lib/money'
import { Confirm, Empty, Money, Screen, Sheet, SummaryBar } from '../components/ui'
import { TxRow } from '../components/TxRow'

export function Accounts({
  month,
  onEdit,
  editorRequest,
  onEditorClosed,
}: {
  month: string
  onEdit: (tx: Transaction) => void
  editorRequest?: boolean
  onEditorClosed?: () => void
}) {
  const { db } = useStore()
  const [detail, setDetail] = useState<string | null>(null)
  const [editor, setEditor] = useState<Account | 'new' | null>(editorRequest ? 'new' : null)

  const { assets, liabilities, total } = assetsLiabilities(db)
  const groups = accountsByGroup(db)
  const monthTxs = useMemo(() => txsInMonth(db, month), [db, month])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="grid grid-cols-3 text-center py-2.5 border-b shrink-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div>
          <div className="text-[13px]" style={{ color: 'var(--muted)' }}>
            Assets
          </div>
          <Money value={assets} kind="income" hideSymbol className="text-[16px]" />
        </div>
        <div>
          <div className="text-[13px]" style={{ color: 'var(--muted)' }}>
            Liabilities
          </div>
          <Money value={liabilities} kind="expense" hideSymbol className="text-[16px]" />
        </div>
        <div>
          <div className="text-[13px]" style={{ color: 'var(--muted)' }}>
            Total
          </div>
          <Money value={total} kind="plain" hideSymbol className="text-[16px]" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
        {groups.length === 0 && <Empty text="No accounts yet" />}
        {groups.map(([group, accounts]) => {
          const isCard = group === 'Card' || group === 'Debit Card'
          const subtotal = accounts.reduce((a, x) => a + accountBalance(db, x.id), 0)
          return (
            <div key={group}>
              <div
                className="flex items-center px-4 py-3 border-b"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
              >
                <span className="text-[16px] flex-1" style={{ color: 'var(--muted)' }}>
                  {group}
                </span>
                {isCard ? (
                  <>
                    <span className="w-32 text-right text-[13px]" style={{ color: 'var(--muted)' }}>
                      Balance Payable
                    </span>
                    <span className="w-32 text-right text-[13px]" style={{ color: 'var(--muted)' }}>
                      Outst. Balance
                    </span>
                  </>
                ) : (
                  <Money value={subtotal} kind="auto" abs className="text-[16px]" />
                )}
              </div>

              {accounts.map((a) => {
                const bal = accountBalance(db, a.id)
                const payable = monthTxs
                  .filter((t) => t.type === 'expense' && t.accountId === a.id)
                  .reduce((s, t) => s + t.amount, 0)
                return (
                  <button
                    key={a.id}
                    className="w-full flex items-center px-4 py-3.5 border-b text-left text-[16px]"
                    style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
                    onClick={() => setDetail(a.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setEditor(a)
                    }}
                  >
                    <span className="flex-1">
                      {a.name}
                      {a.excludeFromTotal && (
                        <span className="text-[11px] ml-2" style={{ color: 'var(--muted)' }}>
                          excluded
                        </span>
                      )}
                    </span>
                    {isCard ? (
                      <>
                        <Money value={payable} kind="plain" className="w-32 text-right" />
                        <Money value={Math.max(0, -bal)} kind="plain" className="w-32 text-right" />
                      </>
                    ) : (
                      <Money value={bal} kind="auto" abs />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}

        <button
          className="w-full py-4 text-[15px] font-semibold"
          style={{ color: 'var(--accent)' }}
          onClick={() => setEditor('new')}
        >
          + Add account
        </button>
      </div>

      {detail && <AccountDetail id={detail} onBack={() => setDetail(null)} onEdit={onEdit} />}
      {editor && (
        <AccountEditor
          account={editor === 'new' ? null : editor}
          onClose={() => {
            setEditor(null)
            onEditorClosed?.()
          }}
        />
      )}
    </div>
  )
}

function AccountDetail({
  id,
  onBack,
  onEdit,
}: {
  id: string
  onBack: () => void
  onEdit: (tx: Transaction) => void
}) {
  const { db } = useStore()
  const account = db.accounts.find((a) => a.id === id)
  const txs = useMemo(
    () =>
      db.transactions
        .filter((t) => t.accountId === id || t.fromAccountId === id || t.toAccountId === id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [db.transactions, id],
  )
  const t = totalsOf(txs)

  if (!account) return null
  return (
    <Screen title={account.name} onBack={onBack}>
      <div
        className="px-4 py-4 text-center border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
          Balance
        </div>
        <Money value={accountBalance(db, id)} kind="auto" abs className="text-[24px]" />
      </div>
      <SummaryBar income={t.income} expense={t.expense} profit={profitOf(txs)} />
      {txs.length === 0 && <Empty text="No transactions" />}
      {txs.map((tx) => (
        <TxRow key={tx.id} tx={tx} onEdit={onEdit} showDate />
      ))}
    </Screen>
  )
}

export function AccountEditor({
  account,
  onClose,
}: {
  account: Account | null
  onClose: () => void
}) {
  const { db, addAccount, updateAccount, deleteAccount } = useStore()
  const [name, setName] = useState(account?.name ?? '')
  const [group, setGroup] = useState<AccountGroup>(account?.group ?? 'Cash')
  const [balance, setBalance] = useState(
    account ? formatAmount(account.initialBalance, db.settings) : '',
  )
  const [exclude, setExclude] = useState(account?.excludeFromTotal ?? false)
  const [confirm, setConfirm] = useState(false)

  const save = () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      group,
      initialBalance: toPaise(balance.replace(/,/g, '') || '0'),
      excludeFromTotal: exclude,
    }
    if (account) updateAccount({ ...account, ...payload })
    else addAccount(payload)
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={account ? 'Edit account' : 'New account'}>
      <div className="p-4 space-y-4">
        <label className="block">
          <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
            Name
          </div>
          <input
            className="w-full border-b pb-2 text-[15px]"
            style={{ borderColor: 'var(--line)' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CashGalla"
            autoFocus
          />
        </label>

        <div>
          <div className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>
            Group
          </div>
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_GROUPS.map((g) => (
              <button
                key={g}
                className="px-3 py-1.5 rounded-full text-[12px]"
                style={{
                  background: g === group ? 'var(--accent)' : 'var(--bg)',
                  color: g === group ? '#fff' : 'var(--text)',
                }}
                onClick={() => setGroup(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <div className="text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
            Initial balance
          </div>
          <input
            className="w-full border-b pb-2 text-[15px] tabular-nums"
            style={{ borderColor: 'var(--line)' }}
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
          />
        </label>

        <button
          className="flex items-center justify-between w-full text-[14px]"
          onClick={() => setExclude((v) => !v)}
        >
          <span>Exclude from total</span>
          <span
            className="w-10 h-6 rounded-full relative transition"
            style={{ background: exclude ? 'var(--accent)' : 'var(--line)' }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all"
              style={{ left: exclude ? 18 : 2 }}
            />
          </span>
        </button>

        <div className="flex gap-2 pt-2">
          {account && (
            <button
              className="flex-1 py-3 rounded-lg text-[14px]"
              style={{ background: 'var(--bg)', color: 'var(--expense)' }}
              onClick={() => setConfirm(true)}
            >
              Delete
            </button>
          )}
          <button
            className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
            style={{ background: 'var(--accent)' }}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>

      <Confirm
        open={confirm}
        title="Delete account?"
        body="Its transactions will be deleted too."
        confirmLabel="Delete"
        danger
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          if (account) deleteAccount(account.id)
          onClose()
        }}
      />
    </Sheet>
  )
}
