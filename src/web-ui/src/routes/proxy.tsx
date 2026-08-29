/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {useEffect, useState} from 'react';

import {CaCertModal} from '../components/proxy/CaCertModal';
import {ProxyControlBar} from '../components/proxy/ProxyControlBar';
import {ProxyRequestDetail} from '../components/proxy/ProxyRequestDetail';
import {ProxyRequestList} from '../components/proxy/ProxyRequestList';
import {api} from '../lib/api';
import type {
  SessionRequestSummaryEvent,
  ProxyStatusPayload,
} from '../lib/protocol';
import {wsClient} from '../lib/ws';
import {useProxyStore} from '../stores/proxy';

export default function ProxyPage() {
  const [caModalOpen, setCaModalOpen] = useState(false);
  const {setRequests, setStatus, addRequest} = useProxyStore();

  // Initial load
  useEffect(() => {
    let mounted = true;

    // 1. Fetch initial status
    api
      .getProxyStatus()
      .then(statusData => {
        if (mounted) {
          setStatus(statusData);
        }
      })
      .catch(err => {
        console.error('Failed to get proxy status:', err);
      });

    // 2. Fetch initial request history（聚合源：CDP + MITM）
    api
      .getSessionRequests()
      .then(res => {
        if (mounted && res.items) {
          setRequests(res.items);
        }
      })
      .catch(err => {
        console.error('Failed to get session requests:', err);
      });

    // 3. Subscribe to WebSocket events
    const unsubRequest = wsClient.subscribe('session.request', msg => {
      const payload = msg.payload as SessionRequestSummaryEvent;
      addRequest(payload);
    });

    const unsubStatus = wsClient.subscribe('proxy.status', msg => {
      const payload = msg.payload as ProxyStatusPayload;
      setStatus(payload);
    });

    return () => {
      mounted = false;
      unsubRequest();
      unsubStatus();
    };
  }, [setRequests, setStatus, addRequest]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Top Control Bar */}
      <ProxyControlBar onOpenCaModal={() => setCaModalOpen(true)} />

      {/* Main Split Pane Content */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-[var(--color-border-default)]">
        {/* Left Pane: Request List (40% - 45%) */}
        <div className="w-full md:w-[42%] lg:w-[40%] xl:w-[38%] h-1/2 md:h-full flex flex-col overflow-hidden">
          <ProxyRequestList />
        </div>

        {/* Right Pane: Request Detail (58% - 60%) */}
        <div className="flex-1 h-1/2 md:h-full flex flex-col overflow-hidden">
          <ProxyRequestDetail />
        </div>
      </div>

      {/* CA Certificate Modal */}
      <CaCertModal
        isOpen={caModalOpen}
        onClose={() => setCaModalOpen(false)}
      />
    </div>
  );
}
