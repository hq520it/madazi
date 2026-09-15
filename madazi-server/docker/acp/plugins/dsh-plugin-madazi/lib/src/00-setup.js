		window.__madaziFactory = (window.__madaziFactory || 0) + 1;
		const react = require("react");
		const h = react.createElement;
		const { useEffect, useState, useRef } = react;
		// createRoot（React 18+）：常驻发布向导宿主用（react-dom/client 在壳的 module seed 表里）
		let reactDomClient = null;
		try { reactDomClient = require("react-dom/client"); } catch (e) { reactDomClient = null; }
		// 官方 UI primitives：UI 统一铁律——插件界面一律复用 dsh 工作台组件
		// （Modal/Button/Input/Menu + --dsw-alias-* token），不自绘独有控件。
		const prim = require("@deepseek-ai/dsh-client-ui-primitives");
		const { Modal, Button, Input, Menu, IconChevronDownOutline14, IconProjectAddOutline16 } = prim;
