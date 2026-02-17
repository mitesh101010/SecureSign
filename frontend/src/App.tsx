import { FormEvent, useEffect, useState } from "react";

type SystemInfo = { accountId: string; topicId: string; publicKey: string };
type BalanceInfo = { accountId: string; balance: string };

type HistoryItem = {
  txId: string;
  toAccountId: string;
  amountHbar: string;
  status: string;
  consensusTimestamp?: string;
  transactionHash: string;
  createdAt: string;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001";

export function App() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toAccountId, setToAccountId] = useState("");
  const [amountHbar, setAmountHbar] = useState("1");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");

  const loadDashboard = async () => {
    const [sysRes, balRes, txRes] = await Promise.all([
      fetch(`${API_BASE}/system`),
      fetch(`${API_BASE}/balance`),
      fetch(`${API_BASE}/transactions`)
    ]);

    setSystem(await sysRes.json());
    setBalance(await balRes.json());
    const txJson = await txRes.json();
    setHistory(txJson.items ?? []);
  };

  useEffect(() => {
    loadDashboard().catch((error) => setMessage(error.message));
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    setMessage("Submitting transaction signed inside AWS KMS...");
    const res = await fetch(`${API_BASE}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toAccountId, amountHbar, memo })
    });

    const payload = await res.json();
    if (!res.ok) {
      setMessage(`Transfer failed: ${payload.message}`);
      return;
    }

    setMessage(`Transfer successful. Tx ID: ${payload.txId}`);
    await loadDashboard();
  };

  return (
    <main className="layout">
      <h1>Keyless Hedera Wallet using AWS KMS</h1>
      <p className="badge">Verified by AWS KMS + Hedera</p>

      <section>
        <h2>Wallet</h2>
        <p><strong>Account ID:</strong> {balance?.accountId ?? "Loading..."}</p>
        <p><strong>Balance:</strong> {balance?.balance ?? "Loading..."}</p>
        <p><strong>HCS Topic:</strong> {system?.topicId ?? "Loading..."}</p>
      </section>

      <section>
        <h2>Send HBAR</h2>
        <form onSubmit={onSubmit} className="form">
          <label>
            Recipient Account ID
            <input value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} placeholder="0.0.x" required />
          </label>

          <label>
            Amount (HBAR)
            <input value={amountHbar} onChange={(e) => setAmountHbar(e.target.value)} required />
          </label>

          <label>
            Memo
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional memo" />
          </label>

          <button type="submit">Submit Transfer</button>
        </form>
      </section>

      <section>
        <h2>Transaction History</h2>
        <table>
          <thead>
            <tr>
              <th>Tx ID</th>
              <th>Recipient</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.txId}>
                <td>{item.txId}</td>
                <td>{item.toAccountId}</td>
                <td>{item.amountHbar}</td>
                <td>{item.status}</td>
                <td>{item.consensusTimestamp ?? item.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {message && <p>{message}</p>}
    </main>
  );
}
