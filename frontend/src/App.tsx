import { FormEvent, useEffect, useState } from "react";

type SystemInfo = {
  accountId: string;
  topicId: string;
  publicKey: string;
  network: string;
  mirrorNodeBaseUrl: string;
};

type BalanceInfo = { accountId: string; balance: string };

type HistoryItem = {
  txId: string;
  fromAccountId: string;
  toAccountId: string;
  amountTinybar: number;
  amountHbar: string;
  status: string;
  consensusTimestamp?: string;
  transactionHash?: string;
  source: "mirror-node" | "local";
  createdAt: string;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001";

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.message ?? `Request failed for ${url}`);
  }
  return payload as T;
}

export function App() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toAccountId, setToAccountId] = useState("");
  const [amountHbar, setAmountHbar] = useState("1");
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState("");

  const loadDashboard = async () => {
    const [sys, bal, tx] = await Promise.all([
      readJson<SystemInfo>(`${API_BASE}/system`),
      readJson<BalanceInfo>(`${API_BASE}/balance`),
      readJson<{ items: HistoryItem[] }>(`${API_BASE}/transactions?limit=20`)
    ]);

    setSystem(sys);
    setBalance(bal);
    setHistory(tx.items ?? []);
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
        <p><strong>Network:</strong> {system?.network ?? "Loading..."}</p>
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
              <th>To</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Source</th>
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
                <td>{item.source}</td>
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
