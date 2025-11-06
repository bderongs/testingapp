'use client';

import { useEffect, useRef } from 'react';
import { Network } from 'vis-network';

interface SitemapVisualizerProps {
  nodes: Array<{ id: string; label: string; url: string }>;
  edges: Array<{ from: string; to: string }>;
}

export function SitemapVisualizer({ nodes, edges }: SitemapVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) {
      return;
    }

    const options = {
      nodes: {
        shape: 'box',
        font: { size: 12 },
        borderWidth: 1,
        shadow: true,
        color: {
          border: '#94a3b8',
          background: '#f1f5f9',
          highlight: {
            border: '#0ea5e9',
            background: '#e0f2fe',
          },
        },
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
      },
      edges: {
        arrows: 'to',
        color: { color: '#94a3b8', highlight: '#0ea5e9' },
        width: 2,
        smooth: {
          enabled: true,
          type: 'continuous',
          forceDirection: 'none',
          roundness: 0.5,
        },
      },
      physics: {
        enabled: true,
        stabilization: {
          enabled: true,
          iterations: 100,
        },
        barnesHut: {
          gravitationalConstant: -2000,
          centralGravity: 0.3,
          springLength: 95,
          springConstant: 0.04,
          damping: 0.09,
        },
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        zoomView: true,
        dragView: true,
      },
    };

    const network = new Network(containerRef.current, { nodes, edges }, options);

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        const node = nodes.find((n) => n.id === nodeId);
        if (node) {
          window.open(node.url, '_blank');
        }
      }
    });

    networkRef.current = network;

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        No sitemap data available. Run the crawler to generate a sitemap visualization.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div ref={containerRef} className="h-[600px] w-full" />
    </div>
  );
}

